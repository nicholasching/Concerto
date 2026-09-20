import { expect, test } from "bun:test";
import { ParticipantSnapshot } from "@orchestra/contracts";
import { PlaybackEngine, REJOIN_LEAD_MS } from "@orchestra/audio";
import { ClockEstimator } from "@orchestra/sync";
import { FakeClock } from "@orchestra/testkit";
import { SessionState } from "../../backend/src/state";
import { handleClientMessage } from "../../backend/src/messages";
import fixture from "../../fixtures/participant-snapshot.json";
import { asAudioContext, FakeAudioContext } from "../../packages/audio/tests/fake-audio";
import { ShowControl } from "../src/lib/show-control";

test("real estimator and playback engine wait for 16 fresh pairs and rejoin at the current playhead", () => {
  const T0 = 50_000, offsetMs = 250;
  let localMs = T0;
  const snapshot = ParticipantSnapshot.parse(structuredClone(fixture));
  snapshot.assignment.channelId = "channel-0";
  snapshot.transport = { status: "playing", transportRevision: 3, showRevision: 1, positionMs: 0, startServerMs: T0 + offsetMs };
  const clock = new ClockEstimator({ now: () => localMs, timeOriginMs: 0 });
  const ctx = new FakeAudioContext(); ctx.state = "running";
  const updateOutput = () => { ctx.currentTime = 10 + (localMs - T0) / 1000; ctx.outputTimestamp = { contextTime: ctx.currentTime - 0.12, performanceTime: localMs }; };
  updateOutput();
  const engine = new PlaybackEngine({ ctx: asAudioContext(ctx), output: {} as AudioNode, clock, buffer: () => ({} as AudioBuffer) });
  const control = new ShowControl({
    identity: () => snapshot, send: () => {}, preload: async () => {},
    now: () => clock.quality().ready ? clock.nowServerMs() : null,
    facts: () => ({ audioRunning: true, audioOutputReady: true, clockUsable: clock.quality().ready, verified: () => true }),
  });
  control.applySnapshot(snapshot);
  control.attach(engine);
  const pair = () => {
    const probeGroupId = clock.beginProbeGroup(), first = localMs;
    for (const probeGroupIndex of [0, 1] as const) {
      const t0 = first + probeGroupIndex * 25;
      localMs = t0 + 4;
      clock.accept({ probeGroupId, probeGroupIndex, t0, t1: t0 + offsetMs + 2, t2: t0 + offsetMs + 2, serverEpoch: snapshot.serverEpoch });
    }
    localMs += 46; updateOutput(); control.refreshReadiness();
  };
  for (let n = 0; n < 15; n++) pair();
  expect(clock.quality().ready).toBe(false);
  expect(ctx.sources).toHaveLength(0);
  pair();
  expect(clock.quality().ready).toBe(true);
  expect(ctx.sources).toHaveLength(1);
  const [start, sourceOffset] = ctx.sources[0].startArgs[0];
  expect(start).toBeCloseTo(ctx.currentTime - 0.12 + REJOIN_LEAD_MS / 1000, 8);
  expect(sourceOffset).toBeCloseTo((localMs - T0 + REJOIN_LEAD_MS) / 1000, 8);

  control.disconnected(); clock.reset();
  expect(ctx.sources[0].stopped).toBe(1);
  control.applySnapshot(snapshot); // socket comes back before clock samples
  const count = ctx.sources.length;
  for (let n = 0; n < 15; n++) pair();
  expect(ctx.sources).toHaveLength(count);
  pair();
  expect(ctx.sources).toHaveLength(count + 1);
  expect(ctx.sources.at(-1)!.startArgs[0][1]).toBeCloseTo((localMs - T0 + REJOIN_LEAD_MS) / 1000, 8);
  control.refreshReadiness();
  expect(ctx.sources).toHaveLength(count + 1); // readiness polling never restarts music
  engine.dispose();
});

test("a manual section selected during playback reaches the matching buffer at the shared playhead after output warms", () => {
  const T0 = 100_000;
  const clock = new FakeClock(T0, 0);
  const serverClock = { sessionId: "manual-test", serverEpoch: "manual-epoch", nowServerMs: () => clock.nowServerMs() };
  const state = new SessionState(); state.saveShow(ParticipantSnapshot.parse(fixture).show);
  state.register(0); state.register(1); state.setConnected(0, true);
  state.scheduleTransport({ domain: "transport", commandId: "play", effectiveServerMs: T0, supersedesCommandId: null,
    transport: { status: "playing", transportRevision: 2, showRevision: state.showRevision, positionMs: 0, startServerMs: T0 } }, [1]);
  state.applyDue(T0);
  let outputReady = false;
  const ctx = new FakeAudioContext(); ctx.state = "running";
  const advance = (ms: number) => { clock.advance(ms); ctx.currentTime = 10 + (clock.nowServerMs() - T0) / 1000;
    ctx.outputTimestamp = { contextTime: ctx.currentTime - 0.04, performanceTime: clock.nowServerMs() }; };
  advance(1000);
  const buffers = new Map(state.show.tracks.map(track => [track.trackId, { trackId: track.trackId } as unknown as AudioBuffer]));
  const engine = new PlaybackEngine({ ctx: asAudioContext(ctx), output: {} as AudioNode, clock, buffer: id => buffers.get(id) });
  const control = new ShowControl({ identity: () => ({ ...serverClock, deviceId: 0 }), send: () => {}, preload: async () => {},
    now: () => clock.nowServerMs(), facts: () => ({ audioRunning: true, audioOutputReady: outputReady, clockUsable: true, verified: () => true }) });
  control.applySnapshot(state.participantSnapshot(0, serverClock)!); control.attach(engine);
  const chosen = handleClientMessage({ clock: serverClock, state, deviceId: 0, receivedServerMs: clock.nowServerMs(),
    raw: JSON.stringify({ protocolVersion: 1, sessionId: serverClock.sessionId, serverEpoch: serverClock.serverEpoch,
      messageId: "manual", type: "participant.column", payload: { column: "center" } }) });
  if (chosen.type !== "state.snapshot" || chosen.payload.role !== "participant") throw new Error("Expected participant snapshot");
  control.applySnapshot(chosen.payload);
  expect(ctx.sources).toHaveLength(0);
  advance(2000);
  state.applyStatus(0, { ...state.readinessOf(0)!, connected: true, foreground: true, clockReady: true, audioUnlocked: true,
    clockUncertaintyMs: 2, clockSampleAgeMs: 0, decodedTrackHashes: Object.fromEntries(state.show.tracks.map(track => [track.trackId, track.sha256])) });
  const joined = state.participantSnapshot(0, serverClock)!;
  expect(joined.transport.status).toBe("playing");
  control.applySnapshot(joined);
  control.handle({ protocolVersion: 1, sessionId: serverClock.sessionId, serverEpoch: serverClock.serverEpoch,
    messageId: "lease", type: "lease.renew", payload: { expiresServerMs: clock.nowServerMs() + 5000 } });
  expect(ctx.sources).toHaveLength(0); // server admission cannot bypass the local output warmup
  advance(300); outputReady = true; control.refreshReadiness();
  expect(ctx.sources).toHaveLength(1);
  const source = ctx.sources[0];
  const vocalTrack = state.show.clips.find(clip => clip.channelId === joined.assignment.channelId)!.trackId;
  expect(source.buffer).toBe(buffers.get(vocalTrack));
  expect(source.startArgs[0][1]).toBeCloseTo((3300 + REJOIN_LEAD_MS) / 1000, 8);
  expect(source.startArgs[0][0]).toBeCloseTo(ctx.currentTime - 0.04 + REJOIN_LEAD_MS / 1000, 8);
  expect(ctx.gains[1].gain.at(source.startArgs[0][0])).toBe(1); // fresh lease opens the audible gate
  control.applySnapshot(state.participantSnapshot(0, serverClock)!); control.refreshReadiness();
  expect(ctx.sources).toHaveLength(1);
  state.panic(); control.applySnapshot(state.participantSnapshot(0, serverClock)!);
  expect(source.stopped).toBeGreaterThan(0);
  engine.dispose();
});
