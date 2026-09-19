import { ClientMessage, type ClientMessageData, type ParticipantSnapshotData, type ServerMessageData, type ShowData } from "@orchestra/contracts";
import { showPositionAt, type MixState, type TransportData } from "@orchestra/audio";

type Message<T extends ServerMessageData["type"]> = Extract<ServerMessageData, { type: T }>;
interface Pending<T> { value: T; atServerMs: number }

/** The part of PlaybackEngine that ShowControl drives; a fake in tests. */
export interface Engine {
  load(show: ShowData, transport: TransportData, channelId: string | null, mix: MixState): void;
  setTransport(transport: TransportData, atServerMs: number): void;
  setChannel(channelId: string | null, atServerMs: number): void;
  setMix(mix: MixState, atServerMs: number): void;
  panic(): void;
  renewLease(expiresServerMs: number): void;
  contextResumed(): void;
}

export interface PlaybackFacts {
  audioRunning: boolean;
  clockUsable: boolean;
  /** True when this exact track (id and hash) is decoded and verified. */
  verified: (trackId: string, sha256: string) => boolean;
}

export interface ShowControlOptions {
  send: (message: ClientMessageData) => void;
  identity: () => { sessionId: string; serverEpoch: string; deviceId: number } | null;
  facts: () => PlaybackFacts;
  preload: (show: ShowData) => Promise<void>;
  /** Current server time, or null when no usable clock exists. */
  now: () => number | null;
}

export interface PlaybackView {
  channelId: string | null;
  transport: TransportData | null;
  positionMs: number;
  pendingTransport: Pending<TransportData> | null;
  pendingChannel: Pending<string | null> | null;
  panicked: boolean;
}

// Authoritative playback state as this phone knows it, and the ready/commit protocol around it.
// Revisions only move forward; a commit at or below what was applied is ignored.
export class ShowControl {
  private show: ShowData | null = null;
  private transport: TransportData | null = null;
  private channelId: string | null = null;
  private mix: MixState | null = null;
  private pendingTransport: Pending<TransportData> | null = null;
  private pendingChannel: Pending<string | null> | null = null;
  private pendingMix: Pending<MixState> | null = null;
  private leaseExpiresMs: number | null = null;
  private transportRevision = -1;
  private assignmentRevision = -1;
  private mixRevision = -1;
  private panicRevision = -1;
  private panicked = false;
  private engine: Engine | null = null;
  /** Effective master gain, including recovery from the authoritative snapshot. */
  private lastMasterGain = 1;
  private epoch: string | null = null;
  private needsReload = false;

  constructor(private readonly options: ShowControlOptions) {}

  attach(engine: Engine | null): void {
    this.engine = engine;
    this.settle();
    this.reloadEngine();
  }

  disconnected(): void {
    this.engine?.panic();
    this.leaseExpiresMs = null;
    this.needsReload = true;
  }

  contextResumed(): void { this.engine?.contextResumed(); }

  applySnapshot(snapshot: ParticipantSnapshotData): void {
    const epochChanged = this.epoch !== snapshot.serverEpoch;
    if (epochChanged) {
      if (this.epoch !== null) this.engine?.panic();
      this.epoch = snapshot.serverEpoch;
      this.transportRevision = this.assignmentRevision = this.mixRevision = this.panicRevision = -1;
      this.panicked = false;
      this.leaseExpiresMs = null;
      this.lastMasterGain = 1;
    }
    this.settle();
    const before = { show: JSON.stringify([this.show?.showId, this.show?.showRevision]),
      transport: JSON.stringify([this.transport, this.pendingTransport]), channel: JSON.stringify([this.channelId, this.pendingChannel]),
      mix: JSON.stringify([this.mix, this.pendingMix]) };
    this.show = snapshot.show;
    if (snapshot.transport.transportRevision > this.panicRevision) this.panicked = false;
    this.transport = this.guardPanic(snapshot.transport);
    this.transportRevision = snapshot.transport.transportRevision;
    this.channelId = snapshot.assignment.channelId;
    this.assignmentRevision = snapshot.assignment.assignmentRevision;
    this.lastMasterGain = snapshot.mix.masterGain;
    this.mixRevision = snapshot.mix.mixRevision;
    this.mix = { masterGain: snapshot.mix.masterGain, channels: snapshot.show.channels };
    this.pendingTransport = this.pendingChannel = this.pendingMix = null;
    for (const action of snapshot.pendingActions) {
      if (action.domain === "transport" && action.transport.transportRevision > this.transportRevision && action.transport.transportRevision > this.panicRevision) {
        this.pendingTransport = { value: action.transport, atServerMs: action.effectiveServerMs };
      } else if (action.domain === "assignment") {
        const mine = action.assignments.find(item => item.deviceId === snapshot.deviceId);
        if (mine && mine.assignmentRevision > this.assignmentRevision) this.pendingChannel = { value: mine.channelId, atServerMs: action.effectiveServerMs };
      } else if (action.domain === "mix" && action.mixRevision > this.mixRevision) {
        this.pendingMix = { value: { masterGain: action.masterGain, channels: action.channels }, atServerMs: action.effectiveServerMs };
      }
    }
    if (epochChanged || this.needsReload || before.show !== JSON.stringify([this.show.showId, this.show.showRevision])) this.reloadEngine();
    else {
      const now = this.options.now() ?? snapshot.serverMs;
      if (before.transport !== JSON.stringify([this.transport, this.pendingTransport])) this.engine?.setTransport(this.pendingTransport?.value ?? this.transport, this.pendingTransport?.atServerMs ?? now);
      if (before.channel !== JSON.stringify([this.channelId, this.pendingChannel])) this.engine?.setChannel(this.pendingChannel ? this.pendingChannel.value : this.channelId, this.pendingChannel?.atServerMs ?? now);
      if (before.mix !== JSON.stringify([this.mix, this.pendingMix])) this.engine?.setMix(this.pendingMix?.value ?? this.mix, this.pendingMix?.atServerMs ?? now);
    }
    this.transportRevision = Math.max(this.transportRevision, this.pendingTransport?.value.transportRevision ?? -1);
    for (const action of snapshot.pendingActions) {
      if (action.domain === "mix") this.mixRevision = Math.max(this.mixRevision, action.mixRevision);
      if (action.domain === "assignment") this.assignmentRevision = Math.max(this.assignmentRevision, action.assignments.find(item => item.deviceId === snapshot.deviceId)?.assignmentRevision ?? -1);
    }
    this.needsReload = false;
  }

  handle(message: ServerMessageData): void {
    switch (message.type) {
      case "assets.prepare": void this.onAssetsPrepare(message); break;
      case "assignment.prepare": this.onAssignmentPrepare(message); break;
      case "assignment.commit": this.onAssignmentCommit(message); break;
      case "transport.prepare": this.onTransportPrepare(message); break;
      case "transport.commit": this.onTransportCommit(message); break;
      case "mix.commit": this.onMixCommit(message); break;
      case "panic": this.onPanic(); break;
      case "lease.renew":
        this.leaseExpiresMs = message.payload.expiresServerMs;
        this.engine?.renewLease(message.payload.expiresServerMs);
        break;
    }
  }

  view(): PlaybackView {
    const now = this.options.now();
    const due = <T>(pending: Pending<T> | null) => pending !== null && now !== null && pending.atServerMs <= now;
    const transport = due(this.pendingTransport) ? this.pendingTransport!.value : this.transport;
    const channelId = due(this.pendingChannel) ? this.pendingChannel!.value : this.channelId;
    return {
      channelId,
      transport,
      positionMs: transport && now !== null ? showPositionAt(transport, now) : 0,
      pendingTransport: due(this.pendingTransport) ? null : this.pendingTransport,
      pendingChannel: due(this.pendingChannel) ? null : this.pendingChannel,
      panicked: this.panicked,
    };
  }

  private async onAssetsPrepare(message: Message<"assets.prepare">): Promise<void> {
    const { preparationId, show } = message.payload;
    if (this.show === null || show.showRevision >= this.show.showRevision) {
      this.show = show;
      this.reloadEngine();
    }
    await this.options.preload(show).catch(() => {});
    const facts = this.options.facts();
    const trackHashes = Object.fromEntries(show.tracks.filter(track => facts.verified(track.trackId, track.sha256)).map(track => [track.trackId, track.sha256]));
    const reason = !facts.audioRunning ? "audio-locked" : Object.keys(trackHashes).length < show.tracks.length ? "assets-missing" : null;
    this.reply({ type: "assets.ready", payload: { preparationId, ready: reason === null, reason, showRevision: show.showRevision, trackHashes } });
  }

  private onAssignmentPrepare(message: Message<"assignment.prepare">): void {
    const me = this.options.identity();
    const { preparationId, assignment } = message.payload;
    if (!me || assignment.deviceId !== me.deviceId) return;
    const reason = !this.options.facts().audioRunning ? "audio-locked" : !this.options.facts().clockUsable ? "clock-or-foreground" : !this.channelReady(assignment.channelId) ? "assets-missing" : null;
    this.reply({ type: "assignment.ready", payload: { preparationId, ready: reason === null, reason, assignmentRevision: assignment.assignmentRevision } });
  }

  private onAssignmentCommit(message: Message<"assignment.commit">): void {
    const me = this.options.identity();
    const mine = me && message.payload.assignments.find(item => item.deviceId === me.deviceId);
    if (!mine || mine.assignmentRevision <= this.assignmentRevision) return;
    this.assignmentRevision = mine.assignmentRevision;
    this.settle();
    this.pendingChannel = { value: mine.channelId, atServerMs: message.effectiveServerMs };
    this.engine?.setChannel(mine.channelId, message.effectiveServerMs);
  }

  private onTransportPrepare(message: Message<"transport.prepare">): void {
    const { preparationId, showRevision, transportRevision } = message.payload;
    const facts = this.options.facts();
    const channel = this.pendingChannel ? this.pendingChannel.value : this.channelId;
    const reason = !facts.audioRunning ? "audio-locked"
      : !facts.clockUsable ? "clock"
      : this.show?.showRevision !== showRevision ? "show-mismatch"
      : !this.channelReady(channel) ? "assets-missing"
      : null;
    this.reply({ type: "transport.ready", payload: { preparationId, ready: reason === null, reason, showRevision, transportRevision } });
  }

  private onTransportCommit(message: Message<"transport.commit">): void {
    const { transport } = message.payload;
    if (transport.transportRevision <= this.transportRevision || transport.transportRevision <= this.panicRevision) return;
    this.transportRevision = transport.transportRevision;
    this.panicked = false;
    this.settle();
    this.pendingTransport = { value: transport, atServerMs: message.effectiveServerMs };
    this.engine?.setTransport(transport, message.effectiveServerMs);
  }

  private onMixCommit(message: Message<"mix.commit">): void {
    const { mixRevision, masterGain, channels } = message.payload;
    if (mixRevision <= this.mixRevision) return;
    this.mixRevision = mixRevision;
    this.lastMasterGain = masterGain;
    this.settle();
    this.pendingMix = { value: { masterGain, channels }, atServerMs: message.effectiveServerMs };
    this.engine?.setMix(this.pendingMix.value, message.effectiveServerMs);
  }

  private onPanic(): void {
    this.panicRevision = Math.max(this.transportRevision, this.pendingTransport?.value.transportRevision ?? -1);
    this.panicked = true;
    this.pendingTransport = null;
    this.pendingChannel = this.pendingMix = null;
    this.leaseExpiresMs = null;
    if (this.transport) this.transport = this.guardPanic(this.transport);
    this.engine?.panic();
  }

  /** Fold pending changes whose time has passed into the effective state, so a new pending one can replace the slot. */
  private settle(): void {
    const now = this.options.now();
    if (now === null) return;
    if (this.pendingTransport && this.pendingTransport.atServerMs <= now) { this.transport = this.pendingTransport.value; this.pendingTransport = null; }
    if (this.pendingChannel && this.pendingChannel.atServerMs <= now) { this.channelId = this.pendingChannel.value; this.pendingChannel = null; }
    if (this.pendingMix && this.pendingMix.atServerMs <= now) { this.mix = this.pendingMix.value; this.pendingMix = null; }
  }

  private guardPanic(transport: TransportData): TransportData {
    if (transport.status === "stopped" || transport.transportRevision > this.panicRevision) return transport;
    return { status: "stopped", transportRevision: transport.transportRevision, showRevision: transport.showRevision, positionMs: 0, startServerMs: null };
  }

  private channelReady(channelId: string | null): boolean {
    if (channelId === null) return true;
    if (!this.show) return false;
    const facts = this.options.facts();
    const trackIds = new Set(this.show.clips.filter(clip => clip.channelId === channelId).map(clip => clip.trackId));
    return this.show.tracks.filter(track => trackIds.has(track.trackId)).every(track => facts.verified(track.trackId, track.sha256));
  }

  private reloadEngine(): void {
    const engine = this.engine;
    if (!engine || !this.show || !this.transport) return;
    engine.load(this.show, this.transport, this.channelId, this.mix ?? { masterGain: this.lastMasterGain, channels: this.show.channels });
    if (this.pendingTransport) engine.setTransport(this.pendingTransport.value, this.pendingTransport.atServerMs);
    if (this.pendingChannel) engine.setChannel(this.pendingChannel.value, this.pendingChannel.atServerMs);
    if (this.pendingMix) engine.setMix(this.pendingMix.value, this.pendingMix.atServerMs);
    if (this.leaseExpiresMs !== null) engine.renewLease(this.leaseExpiresMs);
  }

  private reply(body: Pick<Extract<ClientMessageData, { type: "assets.ready" | "assignment.ready" | "transport.ready" }>, "type" | "payload">): void {
    const me = this.options.identity();
    if (!me) return;
    this.options.send(ClientMessage.parse({ protocolVersion: 1, sessionId: me.sessionId, serverEpoch: me.serverEpoch, messageId: crypto.randomUUID(), ...body }));
  }
}
