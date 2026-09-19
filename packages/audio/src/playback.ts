import type { ShowData } from "@orchestra/contracts";
import type { SynchronizedClock } from "@orchestra/sync";
import { clipStarts, REJOIN_LEAD_MS, type TransportData } from "./timeline";
import { serverMsToAudioTime } from "./timing";

export const RAMP_MS = 30;
export type ChannelMix = ShowData["channels"][number];
export interface MixState { masterGain: number; channels: ChannelMix[] }

interface PlaybackState { transport: TransportData; channelId: string | null }
interface Pending<T> { value: T; atServerMs: number }
interface Segment extends PlaybackState {
  startServerMs: number;
  endServerMs: number | null;
  gain: GainNode;
  sources: AudioBufferSourceNode[];
  clipGains: GainNode[];
}

export interface PlaybackEngineOptions {
  ctx: AudioContext;
  output: AudioNode;
  clock: SynchronizedClock;
  buffer: (trackId: string) => AudioBuffer | undefined;
}

export function channelLevel(channel: ChannelMix, channels: ChannelMix[]): number {
  if (channel.mute) return 0;
  if (channels.some(item => item.solo) && !channel.solo) return 0;
  return channel.gain;
}

// Plays one assigned channel of the show timeline. Each state change becomes a segment that
// starts at a common server time; the previous segment fades out at that moment. Segments that
// haven't started can be torn down without a glitch, so a superseded change is simply rebuilt.
// Graph: source -> clip gain -> segment gain -> channel gain -> master -> lease gate -> output.
export class PlaybackEngine {
  private show: ShowData | null = null;
  private state: PlaybackState | null = null;
  private pendingTransport: Pending<TransportData> | null = null;
  private pendingChannel: Pending<string | null> | null = null;
  private segments: Segment[] = [];
  private readonly master: GainNode;
  private readonly gate: GainNode;
  private readonly channelGains = new Map<string, GainNode>();
  private readonly ramps = new Map<AudioParam, { from: number; to: number; at: number }>();
  private mix: MixState = { masterGain: 1, channels: [] };
  private pendingMix: Pending<MixState> | null = null;
  private panicked = false;
  readonly missingTracks = new Set<string>();

  constructor(private readonly options: PlaybackEngineOptions) {
    const { ctx } = options;
    this.master = ctx.createGain();
    this.gate = ctx.createGain();
    this.gate.gain.value = 0; // silent until the first lease
    this.master.connect(this.gate);
    this.gate.connect(options.output);
  }

  /** Replace everything, e.g. from a snapshot. Stops all current sources. */
  load(show: ShowData, transport: TransportData, channelId: string | null, mix: MixState): void {
    for (const segment of this.segments) this.kill(segment);
    this.segments = [];
    this.show = show;
    this.state = { transport, channelId };
    this.pendingTransport = null;
    this.pendingChannel = null;
    this.pendingMix = null;
    this.panicked = false;
    this.setMix(mix, this.now());
    this.rebuild();
  }

  setTransport(transport: TransportData, atServerMs: number): void {
    this.panicked = false;
    this.pendingTransport = { value: transport, atServerMs };
    this.rebuild();
  }

  setChannel(channelId: string | null, atServerMs: number): void {
    this.pendingChannel = { value: channelId, atServerMs };
    this.rebuild();
  }

  /** Gains change at a server time; asset timing never does. */
  setMix(mix: MixState, atServerMs: number): void {
    this.promote(this.now());
    const at = Math.max(atServerMs, this.now());
    if (atServerMs <= this.now()) { this.mix = mix; this.pendingMix = null; }
    else this.pendingMix = { value: mix, atServerMs: at };
    this.ramp(this.master.gain, mix.masterGain, at);
    for (const [channelId, node] of this.channelGains) this.ramp(node.gain, this.levelOf(channelId, mix), at);
  }

  /** Immediate: stop every source and close the output gate. */
  panic(): void {
    for (const segment of this.segments) this.kill(segment);
    this.segments = [];
    this.pendingTransport = null;
    this.pendingChannel = null;
    this.pendingMix = null;
    this.panicked = true;
    if (this.state) this.state = { ...this.state, transport: stopped(this.state.transport) };
    this.closeGate();
  }

  /** Keep the output gate open until expiresServerMs, on the audio clock. */
  renewLease(expiresServerMs: number): void {
    const param = this.gate.gain;
    const now = this.audio(this.now());
    param.cancelScheduledValues(now);
    if (expiresServerMs <= this.now()) { param.setValueAtTime(0, now); return; }
    param.setValueAtTime(1, now);
    param.setValueAtTime(0, this.audio(expiresServerMs));
  }

  /** After an AudioContext interruption the audio clock has moved: rejoin and wait for a fresh lease. */
  contextResumed(): void {
    for (const segment of this.segments) this.kill(segment);
    this.segments = [];
    this.closeGate();
    this.rebuild();
  }

  /** Housekeeping only (not timing): release sources that have faded out. */
  tick(): void {
    const now = this.now();
    this.promote(now);
    const current = this.current(now);
    this.segments = this.segments.filter(segment => {
      const finished = segment !== current && segment.endServerMs !== null && segment.endServerMs + RAMP_MS < now;
      if (finished) this.kill(segment);
      return !finished;
    });
  }

  dispose(): void {
    for (const segment of this.segments) this.kill(segment);
    this.segments = [];
    for (const node of this.channelGains.values()) node.disconnect();
    this.master.disconnect();
    this.gate.disconnect();
  }

  private now(): number { return this.options.clock.nowServerMs(); }
  private audio(serverMs: number): number { return Math.max(0, serverMsToAudioTime(this.options.clock, this.options.ctx, serverMs)); }

  private promote(now: number): void {
    if (this.pendingMix && this.pendingMix.atServerMs <= now) { this.mix = this.pendingMix.value; this.pendingMix = null; }
    if (!this.state) return;
    if (this.pendingTransport && this.pendingTransport.atServerMs <= now) {
      this.state = { ...this.state, transport: this.pendingTransport.value };
      this.pendingTransport = null;
    }
    if (this.pendingChannel && this.pendingChannel.atServerMs <= now) {
      this.state = { ...this.state, channelId: this.pendingChannel.value };
      this.pendingChannel = null;
    }
  }

  private current(now: number): Segment | undefined {
    return this.segments.filter(segment => segment.startServerMs <= now).at(-1);
  }

  private rebuild(): void {
    if (!this.show || !this.state) return;
    const now = this.now();
    this.promote(now);
    // Future segments haven't made a sound yet; drop them and plan again.
    for (const segment of this.segments.filter(item => item.startServerMs > now)) this.kill(segment);
    this.segments = this.segments.filter(item => item.startServerMs <= now);
    let previous = this.current(now);
    let state: PlaybackState = this.state;
    if (previous && previous.transport === state.transport && previous.channelId === state.channelId) {
      this.unfade(previous, now);
    } else {
      // Nothing matches the effective state (first load, late command, resume). Joining something
      // that is already playing needs a little lead to schedule; a silent state can start now.
      const sounding = state.transport.status === "playing" && state.channelId !== null && !this.panicked;
      const rejoin = sounding ? now + REJOIN_LEAD_MS : now;
      if (previous) this.fade(previous, rejoin);
      previous = this.createSegment(rejoin, state);
    }
    const changes = [
      ...(this.pendingTransport ? [{ at: this.pendingTransport.atServerMs, apply: (s: PlaybackState) => ({ ...s, transport: this.pendingTransport!.value }) }] : []),
      ...(this.pendingChannel ? [{ at: this.pendingChannel.atServerMs, apply: (s: PlaybackState) => ({ ...s, channelId: this.pendingChannel!.value }) }] : []),
    ].sort((a, b) => a.at - b.at);
    for (const change of changes) {
      state = change.apply(state);
      const at = Math.max(change.at, previous.startServerMs);
      this.fade(previous, at);
      previous = this.createSegment(at, state);
    }
  }

  private createSegment(startServerMs: number, state: PlaybackState): Segment {
    const { ctx } = this.options;
    const gain = ctx.createGain();
    const start = this.audio(startServerMs);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(1, start + RAMP_MS / 1000);
    const segment: Segment = { ...state, startServerMs, endServerMs: null, gain, sources: [], clipGains: [] };
    this.segments.push(segment);
    if (this.panicked || state.channelId === null) return segment;
    gain.connect(this.channelGain(state.channelId));
    for (const clip of clipStarts(this.show!, state.channelId, state.transport, startServerMs)) {
      const buffer = this.options.buffer(clip.trackId);
      if (!buffer) { this.missingTracks.add(clip.trackId); continue; }
      const source = ctx.createBufferSource();
      const clipGain = ctx.createGain();
      source.buffer = buffer;
      clipGain.gain.value = clip.gain;
      source.connect(clipGain);
      clipGain.connect(gain);
      // A finished source only releases its own nodes; it never moves the show on.
      source.onended = () => { source.disconnect(); clipGain.disconnect(); };
      source.start(this.audio(clip.startServerMs), clip.offsetMs / 1000, clip.durationMs / 1000);
      segment.sources.push(source);
      segment.clipGains.push(clipGain);
    }
    return segment;
  }

  private fade(segment: Segment, atServerMs: number): void {
    const param = segment.gain.gain;
    const at = this.audio(atServerMs);
    param.cancelScheduledValues(at);
    param.setValueAtTime(1, at);
    param.linearRampToValueAtTime(0, at + RAMP_MS / 1000);
    segment.endServerMs = atServerMs;
  }

  private unfade(segment: Segment, now: number): void {
    if (segment.endServerMs === null) return;
    const param = segment.gain.gain;
    param.cancelScheduledValues(this.audio(now));
    param.linearRampToValueAtTime(1, Math.max(this.audio(now), this.audio(segment.startServerMs) + RAMP_MS / 1000));
    segment.endServerMs = null;
  }

  private kill(segment: Segment): void {
    for (const source of segment.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* never started */ }
      source.disconnect();
    }
    segment.sources = [];
    for (const gain of segment.clipGains) gain.disconnect();
    segment.clipGains = [];
    segment.gain.disconnect();
  }

  private channelGain(channelId: string): GainNode {
    let node = this.channelGains.get(channelId);
    if (!node) {
      node = this.options.ctx.createGain();
      node.gain.value = this.levelOf(channelId);
      node.connect(this.master);
      this.channelGains.set(channelId, node);
      if (this.pendingMix) this.ramp(node.gain, this.levelOf(channelId, this.pendingMix.value), this.pendingMix.atServerMs);
    }
    return node;
  }

  private levelOf(channelId: string, mix = this.mix): number {
    const channel = mix.channels.find(item => item.channelId === channelId);
    return channel ? channelLevel(channel, mix.channels) : 0;
  }

  private ramp(param: AudioParam, value: number, atServerMs: number): void {
    const at = this.audio(atServerMs);
    const now = this.audio(this.now());
    const prior = this.ramps.get(param);
    const fraction = prior ? Math.max(0, Math.min(1, (now - prior.at) / (RAMP_MS / 1000))) : 0;
    const current = prior ? prior.from + (prior.to - prior.from) * fraction : param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.setValueAtTime(current, at);
    param.linearRampToValueAtTime(value, at + RAMP_MS / 1000);
    this.ramps.set(param, { from: current, to: value, at });
  }

  private closeGate(): void {
    const now = this.audio(this.now());
    this.gate.gain.cancelScheduledValues(now);
    this.gate.gain.setValueAtTime(0, now);
  }
}

function stopped(transport: TransportData): TransportData {
  return { status: "stopped", transportRevision: transport.transportRevision, showRevision: transport.showRevision, positionMs: 0, startServerMs: null };
}
