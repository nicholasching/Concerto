import { expect, test } from "bun:test";
import { ParticipantSnapshot } from "@orchestra/contracts";
import { PlaybackEngine, REJOIN_LEAD_MS } from "@orchestra/audio";
import { ClockEstimator } from "@orchestra/sync";
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
