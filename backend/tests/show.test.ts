import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { AdminSnapshot, ApiError, CommandAccepted, PROTOCOL_VERSION, type ShowData } from "@orchestra/contracts";
import { createApp } from "../src/app";
import { AssetStore } from "../src/assets";
import { CalibrationRuns } from "../src/calibration";
import { CheckpointStore } from "../src/checkpoint";
import type { ServerClock } from "../src/clock";
import { CommandLog } from "../src/commands";
import { ConnectionRegistry } from "../src/connections";
import { Preparations } from "../src/preparations";
import { DeviceRegistry } from "../src/registry";
import { RateLimiter } from "../src/rate-limit";
import { SessionState } from "../src/state";

const SESSION = "session-under-test";
const SECRET = "operator-secret-for-tests";
const serverMs = 1_000_000;
const clock: ServerClock = { sessionId: SESSION, serverEpoch: "epoch-a", nowServerMs: () => serverMs };

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(joinPath(tmpdir(), "orchestra-show-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const harness = () => {
  const state = new SessionState();
  const registry = new DeviceRegistry();
  const store = new CheckpointStore(joinPath(directory, "checkpoint.json"));
  const app = createApp({
    clock, registry, state, store, operatorSecret: SECRET,
    commands: new CommandLog(),
    connections: new ConnectionRegistry(),
    preparations: new Preparations(),
    assets: new AssetStore(joinPath(directory, "assets")),
    uploads: new AssetStore(joinPath(directory, "uploads")),
    calibrations: new CalibrationRuns(),
    joins: new RateLimiter(100, 100, () => serverMs),
  });
  return { app, state, store, registry };
};

const show = (label: string): ShowData => ({
  showId: "show-1", showRevision: 0, label,
  tracks: [{
    trackId: "track-1", label: "Melody", url: "/api/assets/track-1",
    sha256: "a".repeat(64), byteSize: 1024, durationMs: 30_000, sampleRateHz: 48_000, channels: 2,
  }],
  channels: [{ channelId: "melody", label: "Melody", color: "#3b82f6", gain: 1, mute: false, solo: false }],
  clips: [{ clipId: "clip-1", channelId: "melody", trackId: "track-1", timelineStartMs: 0, sourceOffsetMs: 0, durationMs: 30_000, gain: 1 }],
});

const save = (app: ReturnType<typeof createApp>, options: {
  commandId: string; expectedRevision: number; label?: string; secret?: string;
}) =>
  app.request("/api/show", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-operator-secret": options.secret ?? SECRET },
    body: JSON.stringify({
      protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: "epoch-a",
      commandId: options.commandId, expectedRevision: options.expectedRevision,
      show: show(options.label ?? "First show"),
    }),
  });

describe("saving a show", () => {
  test("replaces the placeholder and takes a server-assigned revision", async () => {
    const { app, state } = harness();
    expect(state.show.showId).toBe("placeholder");

    const accepted = CommandAccepted.parse(await (await save(app, { commandId: "cmd-1", expectedRevision: 0 })).json());

    expect(accepted.revision).toBe(1);
    expect(state.show.showId).toBe("show-1");
    expect(state.show.showRevision).toBe(1);
    expect(state.show.channels).toHaveLength(1);
  });

  test("ignores a revision the client tried to choose for itself", async () => {
    const { app, state } = harness();
    await save(app, { commandId: "cmd-1", expectedRevision: 0 });
    await save(app, { commandId: "cmd-2", expectedRevision: 1, label: "Second show" });

    expect(state.show.showRevision).toBe(2);
    expect(state.show.label).toBe("Second show");
  });

  test("refuses a save built against a stale revision and changes nothing", async () => {
    const { app, state } = harness();
    await save(app, { commandId: "cmd-1", expectedRevision: 0 });

    const response = await save(app, { commandId: "cmd-2", expectedRevision: 0, label: "Clobbering show" });

    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("REVISION_CONFLICT");
    expect(state.show.label).toBe("First show");
    expect(state.show.showRevision).toBe(1);
  });

  test("a retried command applies once and returns its original result", async () => {
    const { app, state } = harness();
    const first = CommandAccepted.parse(await (await save(app, { commandId: "cmd-1", expectedRevision: 0 })).json());
    const retry = CommandAccepted.parse(await (await save(app, { commandId: "cmd-1", expectedRevision: 0 })).json());

    expect(retry).toEqual(first);
    expect(state.show.showRevision).toBe(1);
  });

  test("a different command with identical content is a second save", async () => {
    const { app, state } = harness();
    await save(app, { commandId: "cmd-1", expectedRevision: 0 });
    await save(app, { commandId: "cmd-2", expectedRevision: 1 });
    expect(state.show.showRevision).toBe(2);
  });

  test("readiness churn does not invalidate a pending operator command", async () => {
    const { app, state } = harness();
    state.register(0);
    state.setConnected(0, true);
    state.register(1);
    const churnedRevision = state.revision;

    // The operator's command still names showRevision 0, and the session revision has moved.
    const accepted = CommandAccepted.parse(await (await save(app, { commandId: "cmd-1", expectedRevision: 0 })).json());

    expect(accepted.revision).toBe(1);
    expect(state.revision).toBeGreaterThan(churnedRevision);
  });

  test("requires the operator secret", async () => {
    const { app, state } = harness();
    const response = await save(app, { commandId: "cmd-1", expectedRevision: 0, secret: "wrong" });

    expect(response.status).toBe(401);
    expect(state.show.showId).toBe("placeholder");
  });

  test("the saved show appears in the operator snapshot", async () => {
    const { app } = harness();
    await save(app, { commandId: "cmd-1", expectedRevision: 0 });

    const snapshot = AdminSnapshot.parse(
      await (await app.request(`/api/sessions/${SESSION}/snapshot`, { headers: { "x-operator-secret": SECRET } })).json(),
    );
    expect(snapshot.show.showId).toBe("show-1");
    expect(snapshot.transport).toMatchObject({ status: "stopped", showRevision: 1 });
  });

  test("survives a restart", async () => {
    const first = harness();
    await save(first.app, { commandId: "cmd-1", expectedRevision: 0 });

    const restarted = harness();
    const checkpoint = await restarted.store.read();
    if (!checkpoint?.show) throw new Error("expected a persisted show");
    restarted.state.restoreShow(checkpoint.show);

    expect(restarted.state.show.showId).toBe("show-1");
    expect(restarted.state.showRevision).toBe(1);
    expect(restarted.state.transport.status).toBe("stopped");
  });
});

describe("command log", () => {
  test("keeps results within its cap, discarding the oldest first", () => {
    const log = new CommandLog(3);
    for (const id of ["a", "b", "c", "d"]) log.remember(id, { id });

    expect(log.size).toBe(3);
    expect(log.get("a")).toBeUndefined();
    expect(log.get<{ id: string }>("d")).toEqual({ id: "d" });
  });
});
