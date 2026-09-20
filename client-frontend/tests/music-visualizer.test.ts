import { expect, test } from "bun:test";
import { ParticipantSnapshot, type ServerMessageData } from "@orchestra/contracts";
import fixture from "../../fixtures/participant-snapshot.json";
import { MusicVisualizer } from "../src/lib/music-visualizer";
import { ShowControl } from "../src/lib/show-control";

function setup() {
  const snapshot = ParticipantSnapshot.parse(structuredClone(fixture));
  let now = 100_000;
  let frame: (() => void) | null = null;
  let meters = 0;
  let disposed = 0;
  let brightness = 0.7;
  let paint: { color: string | null; brightness: number } | null = null;
  const control = new ShowControl({
    send: () => {}, identity: () => snapshot,
    facts: () => ({ audioRunning: true, audioOutputReady: true, clockUsable: true, verified: () => true }),
    preload: async () => {}, now: () => now,
  });
  control.applySnapshot(snapshot);
  const renderer = new MusicVisualizer({
    playback: () => control.view(), color: id => snapshot.show.channels.find(channel => channel.channelId === id)?.color,
    createMeter: () => { meters++; return { read: () => brightness, dispose: () => { disposed++; } }; },
    frames: { request: callback => { frame = callback; return 1; }, cancel: () => { frame = null; } },
    now: () => now, paint: (color, level) => { paint = { color, brightness: level }; },
  });
  const envelope = { protocolVersion: 1 as const, sessionId: snapshot.sessionId, serverEpoch: snapshot.serverEpoch, messageId: "visualizer-test", revision: 5 };
  const assign = (channelId: string | null, at: number, revision = 1) => control.handle({
    ...envelope, type: "assignment.commit", effectiveServerMs: at,
    payload: { commandId: `assignment-${revision}`, effectiveServerMs: at, supersedesCommandId: null, domain: "assignment",
      assignments: [{ deviceId: snapshot.deviceId, channelId, assignmentRevision: revision, mapRevision: 1 }] },
  });
  const transport = (status: "playing" | "paused" | "stopped", at: number, revision = 1) => control.handle({
    ...envelope, type: "transport.commit", effectiveServerMs: at,
    payload: { commandId: `transport-${revision}`, effectiveServerMs: at, supersedesCommandId: null, domain: "transport",
      transport: { status, transportRevision: revision, showRevision: snapshot.show.showRevision, positionMs: 0, startServerMs: status === "playing" ? at : null } },
  } as ServerMessageData);
  renderer.start();
  return { renderer, assign, transport, control, snapshot,
    panic: () => control.handle({ ...envelope, type: "panic", payload: { commandId: "panic" } }),
    level: (value: number) => { brightness = value; },
    step: (at: number) => { now = at; const callback = frame; frame = null; callback?.(); return paint; },
    counts: () => ({ meters, disposed, scheduled: frame !== null }),
  };
}

test("scheduled play, pause and resume follow effective clock state without another snapshot", () => {
  const app = setup();
  app.assign("channel-0", 100_000);
  app.transport("playing", 102_000);
  expect(app.step(101_999)?.color).toBeNull();
  expect(app.counts().meters).toBe(0);
  expect(app.step(102_000)).toEqual({ color: app.snapshot.show.channels[0].color, brightness: 0.7 });
  // The connection snapshot still says stopped: only the scheduled protocol has advanced.
  expect(app.snapshot.transport.status).toBe("stopped");
  app.transport("paused", 104_000, 2);
  expect(app.step(103_999)?.color).not.toBeNull();
  expect(app.step(104_000)?.color).toBeNull();
  expect(app.counts().disposed).toBe(1);
  app.transport("playing", 106_000, 3);
  expect(app.step(106_000)?.color).not.toBeNull();
  expect(app.counts().meters).toBe(2);
  app.renderer.stop();
});

test("channel changes use the new color only at their deadline; clearing never uses a fallback color", () => {
  const app = setup();
  app.assign("channel-0", 100_000);
  app.transport("playing", 100_000);
  app.step(100_000);
  app.assign("channel-1", 102_000, 2);
  expect(app.step(101_999)?.color).toBe(app.snapshot.show.channels[0].color);
  expect(app.step(102_000)?.color).toBe(app.snapshot.show.channels[1].color);
  expect(app.counts()).toMatchObject({ meters: 2, disposed: 1 });
  app.assign(null, 104_000, 3);
  expect(app.step(104_000)?.color).toBeNull();
  app.renderer.stop();
});

test("panic hides the light on the next frame and stale play cannot restore it", () => {
  const app = setup();
  app.assign("channel-0", 100_000);
  app.transport("playing", 100_000);
  app.step(100_000);
  app.panic();
  expect(app.step(100_016)?.color).toBeNull();
  app.transport("playing", 100_000);
  expect(app.step(100_032)?.color).toBeNull();
  expect(app.counts().disposed).toBe(1);
  app.renderer.stop();
});

test("the surface follows measured output, including silence after a mute or lease loss", () => {
  const app = setup();
  app.assign("channel-0", 100_000);
  app.transport("playing", 100_000);
  expect(app.step(100_000)?.brightness).toBe(0.7);
  app.level(0.1);
  expect(app.step(100_016)).toEqual({ color: app.snapshot.show.channels[0].color, brightness: 0.1 });
  app.renderer.stop();
});

test("cleanup for calibration, disconnect or unmount removes the meter and all future frames", () => {
  const app = setup();
  app.assign("channel-0", 100_000);
  app.transport("playing", 100_000);
  app.step(100_000);
  app.renderer.stop();
  app.renderer.stop();
  expect(app.counts()).toEqual({ meters: 1, disposed: 1, scheduled: false });
  expect(app.step(200_000)?.color).toBeNull();
});
