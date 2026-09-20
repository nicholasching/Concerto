import { beforeEach, describe, expect, test } from "bun:test";
import { Show, type ShowData } from "@orchestra/contracts";
import { FakeClock } from "@orchestra/testkit";
import showFixture from "../../../fixtures/show.json";
import { channelLevel, clipStarts, PlaybackEngine, RAMP_MS, REJOIN_LEAD_MS, showPositionAt, type MixState, type TransportData } from "../src";
import { asAudioContext, FakeAudioContext, type FakeGain, type FakeParam, type FakeSource } from "./fake-audio";

/** source -> clip gain -> segment gain */
const segmentGainOf = (source: FakeSource) => ((source.outputs[0] as FakeGain).outputs[0] as FakeGain).gain;

const T0 = 100_000; // server ms; audio time = 10 + (server - T0) / 1000
const show: ShowData = Show.parse(showFixture);
const playing = (revision: number, startServerMs: number, positionMs = 0): TransportData => ({ status: "playing", transportRevision: revision, showRevision: 1, positionMs, startServerMs });
const paused = (revision: number, positionMs: number): TransportData => ({ status: "paused", transportRevision: revision, showRevision: 1, positionMs, startServerMs: null });
const stopped = (revision: number): TransportData => ({ status: "stopped", transportRevision: revision, showRevision: 1, positionMs: 0, startServerMs: null });
const audio = (serverMs: number) => 10 + (serverMs - T0) / 1000;

describe("timeline", () => {
  test("position while playing, before its start, paused and stopped", () => {
    expect(showPositionAt(playing(1, T0, 500), T0 + 1200)).toBe(1700);
    expect(showPositionAt(playing(1, T0, 500), T0 - 300)).toBe(500);
    expect(showPositionAt(paused(1, 4200), T0 + 9999)).toBe(4200);
    expect(showPositionAt(stopped(1), T0)).toBe(0);
  });

  test("clips start at the playhead with the matching source offset", () => {
    const [clip] = clipStarts(show, "channel-1", playing(1, T0, 0), T0 + 3000);
    expect(clip).toMatchObject({ trackId: "tone-1", startServerMs: T0 + 3000, offsetMs: 3000, durationMs: 5000 });
  });

  test("a future transport schedules from its own start, and clips after the playhead start later", () => {
    const multi: ShowData = { ...show, clips: [
      { clipId: "a", channelId: "channel-0", trackId: "tone-0", timelineStartMs: 0, sourceOffsetMs: 0, durationMs: 2000, gain: 1 },
      { clipId: "b", channelId: "channel-0", trackId: "tone-1", timelineStartMs: 4000, sourceOffsetMs: 500, durationMs: 2000, gain: 0.5 },
    ] };
    expect(clipStarts(multi, "channel-0", playing(1, T0 + 2000, 1000), T0)).toEqual([
      { clipId: "a", trackId: "tone-0", startServerMs: T0 + 2000, offsetMs: 1000, durationMs: 1000, gain: 1 },
      { clipId: "b", trackId: "tone-1", startServerMs: T0 + 5000, offsetMs: 500, durationMs: 2000, gain: 0.5 },
    ]);
    expect(clipStarts(multi, "channel-0", playing(1, T0, 2500), T0).map(clip => clip.clipId)).toEqual(["b"]);
  });

  test("nothing sounds for a null channel, another channel, past the end, or when not playing", () => {
    expect(clipStarts(show, null, playing(1, T0), T0)).toEqual([]);
    expect(clipStarts(show, "channel-9", playing(1, T0), T0)).toEqual([]);
    expect(clipStarts(show, "channel-0", playing(1, T0, 8000), T0)).toEqual([]);
    expect(clipStarts(show, "channel-0", paused(1, 100), T0)).toEqual([]);
  });

  test("mute and solo set the channel level", () => {
    const channels = show.channels.map(channel => ({ ...channel, solo: channel.channelId === "channel-2" }));
    expect(channelLevel(channels[2], channels)).toBe(0.3);
    expect(channelLevel(channels[0], channels)).toBe(0);
    expect(channelLevel({ ...show.channels[0], mute: true }, show.channels)).toBe(0);
  });
});

describe("engine", () => {
  let ctx: FakeAudioContext;
  let clock: FakeClock;
  let engine: PlaybackEngine;
  let buffers: Set<string>;
  const mix: MixState = { masterGain: 1, channels: show.channels };

  beforeEach(() => {
    ctx = new FakeAudioContext();
    ctx.state = "running";
    ctx.outputTimestamp = { contextTime: 10, performanceTime: T0 };
    clock = new FakeClock(T0, 0);
    buffers = new Set(show.tracks.map(track => track.trackId));
    engine = new PlaybackEngine({ ctx: asAudioContext(ctx), output: {} as AudioNode, clock, buffer: id => buffers.has(id) ? ({ id } as unknown as AudioBuffer) : undefined });
  });
  // master and gate are the first two gains created.
  const gate = () => ctx.gains[1].gain as FakeParam;
  const started = () => ctx.sources.filter(source => source.startArgs.length > 0);
  const startOf = (source: FakeSource) => source.startArgs[0];

  test("a later replacement mix cancels the earlier future automation without affecting current gain", () => {
    engine.load(show, stopped(0), "channel-0", mix);
    clock.advance(100);
    engine.setMix({ ...mix, masterGain: 0.2 }, T0 + 1000);
    engine.setMix({ ...mix, masterGain: 0.7 }, T0 + 2000);
    expect(ctx.gains[0].gain.at(audio(T0 + 1500))).toBe(1);
    expect(ctx.gains[0].gain.at(audio(T0 + 2100))).toBe(0.7);
  });

  test("output clock startup rounding never schedules a negative AudioParam time", () => {
    ctx.outputTimestamp = { contextTime: 0.00000001, performanceTime: T0 + 0.001 };
    engine.load(show, stopped(0), null, mix);
    for (const node of ctx.gains) for (const [kind, first, second] of node.gain.events) {
      expect(kind === "cancel" ? first : second).toBeGreaterThanOrEqual(0);
    }
  });

  test("play schedules the assigned channel at the common start with the right offset", () => {
    engine.load(show, stopped(0), "channel-1", mix);
    engine.setTransport(playing(1, T0 + 2000, 0), T0 + 2000);
    expect(started()).toHaveLength(1);
    expect(startOf(started()[0])).toEqual([audio(T0 + 2000), 0, 8]);
    expect((started()[0].buffer as { id: string }).id).toBe("tone-1");
  });

  test("a play command for 0.5 s ahead starts on time when nothing is playing yet", () => {
    engine.load(show, stopped(0), "channel-0", mix);
    engine.setTransport(playing(1, T0 + 500), T0 + 500);
    expect(startOf(started()[0])[0]).toBe(audio(T0 + 500));
  });

  test("a late join rejoins 1 s ahead at the playhead, not from zero", () => {
    engine.load(show, playing(3, T0 - 2500, 0), "channel-2", mix);
    expect(startOf(started()[0])).toEqual([audio(T0 + REJOIN_LEAD_MS), (2500 + REJOIN_LEAD_MS) / 1000, (8000 - 3500) / 1000]);
  });

  test.each(["channel-2", "channel-3"])("a switch to %s starts at the playhead with a crossfade at the switch time", channelId => {
    engine.load(show, stopped(0), "channel-0", mix);
    engine.setTransport(playing(1, T0 + 1000), T0 + 1000);
    clock.advance(2000); // now T0 + 2000, first segment playing
    engine.setChannel(channelId, T0 + 4000);
    const [first, second] = started();
    expect((second.buffer as { id: string }).id).toBe(channelId === "channel-3" ? "tone-3" : "tone-2");
    expect(startOf(second)).toEqual([audio(T0 + 4000), 3, 5]);
    expect(first.stopped).toBe(0); // the old part keeps sounding until the switch
    expect(segmentGainOf(first).at(audio(T0 + 4000) - 0.001)).toBe(1);
    expect(segmentGainOf(first).at(audio(T0 + 4000) + RAMP_MS / 1000)).toBe(0);
    expect(segmentGainOf(second).at(audio(T0 + 4000))).toBe(0);
    expect(segmentGainOf(second).at(audio(T0 + 4000) + RAMP_MS / 1000)).toBe(1);
  });

  test("pause and stop silence at their effective time; seek reschedules from the new position", () => {
    engine.load(show, playing(1, T0 - 1000), "channel-0", mix);
    clock.advance(REJOIN_LEAD_MS + 100);
    const before = started().length;
    engine.setTransport(paused(2, 4000), T0 + 3000);
    expect(started()).toHaveLength(before); // a pause starts nothing
    engine.setTransport(playing(3, T0 + 3000, 6000), T0 + 3000); // seek replaces the pending pause
    const seek = started().at(-1)!;
    expect(startOf(seek)).toEqual([audio(T0 + 3000), 6, 2]);
  });

  test("a superseded pending change is torn down before it makes a sound", () => {
    engine.load(show, stopped(0), "channel-0", mix);
    engine.setTransport(playing(1, T0 + 3000), T0 + 3000);
    const first = started()[0];
    engine.setTransport(playing(2, T0 + 4000, 1000), T0 + 4000);
    expect(first.stopped).toBe(1);
    expect(first.connected).toBe(false);
    expect(startOf(started().at(-1)!)).toEqual([audio(T0 + 4000), 1, 7]);
  });

  test("a finished source only releases its own nodes", () => {
    engine.load(show, stopped(0), "channel-0", mix);
    engine.setTransport(playing(1, T0 + 1000), T0 + 1000);
    const source = started()[0];
    const count = ctx.sources.length;
    source.onended?.();
    expect(source.connected).toBe(false);
    expect(ctx.sources).toHaveLength(count);
  });

  test("a missing track stays silent and is reported", () => {
    buffers.delete("tone-2");
    engine.load(show, playing(1, T0 - 1000), "channel-2", mix);
    expect(started()).toHaveLength(0);
    expect([...engine.missingTracks]).toEqual(["tone-2"]);
  });

  test("mix changes ramp the master and channel gains at their time", () => {
    engine.load(show, playing(1, T0 - 1000), "channel-0", mix);
    const master = ctx.gains[0].gain as FakeParam;
    engine.setMix({ masterGain: 0.5, channels: show.channels.map(channel => ({ ...channel, mute: channel.channelId === "channel-0" })) }, T0 + 2000);
    expect(master.at(audio(T0 + 2000) + RAMP_MS / 1000)).toBe(0.5);
    const channelGain = ctx.gains.find(gain => gain.outputs.includes(ctx.gains[0]))!;
    expect(channelGain.gain.at(audio(T0 + 1999))).toBe(0.3);
    expect(channelGain.gain.at(audio(T0 + 2000) + RAMP_MS / 1000)).toBe(0);
  });

  test("the lease gate is closed without a lease, opens on renewal and closes at expiry", () => {
    engine.load(show, playing(1, T0 - 1000), "channel-0", mix);
    expect(gate().at(audio(T0))).toBe(0);
    engine.renewLease(T0 + 10_000);
    expect(gate().at(audio(T0 + 5000))).toBe(1);
    expect(gate().at(audio(T0 + 10_000))).toBe(0);
    clock.advance(3000);
    engine.renewLease(T0 + 13_000);
    expect(gate().at(audio(T0 + 12_000))).toBe(1);
    expect(gate().at(audio(T0 + 13_000))).toBe(0);
  });

  test("panic stops every source and closes the gate immediately", () => {
    engine.load(show, playing(1, T0 - 1000), "channel-0", mix);
    engine.renewLease(T0 + 10_000);
    engine.setChannel("channel-1", T0 + 5000);
    engine.panic();
    expect(ctx.sources.every(source => source.stopped === 1)).toBe(true);
    expect(gate().at(audio(T0))).toBe(0);
    const count = started().length;
    engine.setChannel("channel-2", T0 + 6000); // still stopped: nothing starts
    expect(started()).toHaveLength(count);
    // Only a newer transport plays again: channel-0 from +2 s, then the pending switch to channel-2 at +6 s.
    engine.setTransport(playing(2, T0 + 2000), T0 + 2000);
    expect(started().slice(count).map(source => (source.buffer as { id: string }).id)).toEqual(["tone-0", "tone-2"]);
  });

  test("an interrupted context rejoins with the gate closed until the next lease", () => {
    engine.load(show, playing(1, T0 - 1000), "channel-0", mix);
    engine.renewLease(T0 + 10_000);
    const first = started()[0];
    engine.contextResumed();
    expect(first.stopped).toBe(1);
    expect(gate().at(audio(T0 + 100))).toBe(0);
    expect(startOf(started().at(-1)!)[0]).toBe(audio(T0 + REJOIN_LEAD_MS));
  });

  test("tick releases faded segments but keeps the one playing", () => {
    engine.load(show, stopped(0), "channel-0", mix);
    engine.setTransport(playing(1, T0 + 500), T0 + 500);
    engine.setChannel("channel-1", T0 + 2000);
    // The switch rebuilt the not-yet-started play segment, so use the last two sources.
    const [played, switched] = started().slice(-2);
    clock.advance(2000 + RAMP_MS + 10);
    engine.tick();
    expect(played.stopped).toBe(1);
    expect(switched.stopped).toBe(0);
  });
});
