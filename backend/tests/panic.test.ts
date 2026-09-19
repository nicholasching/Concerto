import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { CommandAccepted, PROTOCOL_VERSION, ServerMessage, type ShowData } from "@orchestra/contracts";
import { createApp, DEFAULT_LEAD_TIME_MS } from "../src/app";
import { AssetStore } from "../src/assets";
import { CalibrationRuns } from "../src/calibration";
import { CheckpointStore } from "../src/checkpoint";
import type { ServerClock } from "../src/clock";
import { CommandLog } from "../src/commands";
import { ConnectionRegistry, type ClientSocket } from "../src/connections";
import { JobRunner } from "../src/jobs";
import { AudioLease, LEASE_DURATION_MS } from "../src/lease";
import { Preparations } from "../src/preparations";
import { DeviceRegistry } from "../src/registry";
import { RateLimiter } from "../src/rate-limit";
import { SessionState } from "../src/state";

const SESSION = "session-under-test";
const SECRET = "operator-secret-for-tests";
const EPOCH = "epoch-a";

let directory: string;
let serverMs: number;

beforeEach(async () => {
  directory = await mkdtemp(joinPath(tmpdir(), "orchestra-panic-"));
  serverMs = 1_000_000;
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

class FakeSocket implements ClientSocket {
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  typed(type: string) {
    return this.sent.map(raw => ServerMessage.parse(JSON.parse(raw))).filter(message => message.type === type);
  }
}

const show = (): ShowData => ({
  showId: "show-1", showRevision: 0, label: "Concert",
  tracks: [{
    trackId: "track-1", label: "Melody", url: "/api/assets/track-1", sha256: "a".repeat(64),
    byteSize: 1024, durationMs: 60_000, sampleRateHz: 48_000, channels: 2,
  }],
  channels: [{ channelId: "melody", label: "Melody", color: "#3b82f6", gain: 1, mute: false, solo: false }],
  clips: [{ clipId: "clip-1", channelId: "melody", trackId: "track-1", timelineStartMs: 0, sourceOffsetMs: 0, durationMs: 60_000, gain: 1 }],
});

const harness = () => {
  const clock: ServerClock = { sessionId: SESSION, serverEpoch: EPOCH, nowServerMs: () => serverMs };
  const state = new SessionState();
  const connections = new ConnectionRegistry();
  const preparations = new Preparations();
  const lease = new AudioLease();
  const app = createApp({
    clock, state, connections, preparations, lease, operatorSecret: SECRET,
    registry: new DeviceRegistry(),
    store: new CheckpointStore(joinPath(directory, "checkpoint.json")),
    joins: new RateLimiter(100, 100, () => serverMs),
    commands: new CommandLog(),
    assets: new AssetStore(joinPath(directory, "assets")),
    uploads: new AssetStore(joinPath(directory, "uploads")),
    calibrations: new CalibrationRuns(),
    jobs: new JobRunner(),
    jobWorkspace: joinPath(directory, "jobs"),
  });
  const sockets = new Map<number, FakeSocket>();
  for (const deviceId of [0, 1]) {
    state.register(deviceId);
    state.setConnected(deviceId, true);
    const socket = new FakeSocket();
    sockets.set(deviceId, socket);
    connections.bindParticipant(deviceId, socket);
  }
  return { app, state, connections, preparations, lease, sockets, clock };
};

type Harness = ReturnType<typeof harness>;

const operator = (app: Harness["app"], path: string, body: Record<string, unknown>, method = "POST") =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-operator-secret": SECRET },
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: EPOCH, ...body }),
  });

// A session with a saved show, a prepared cue and a pending mix.
const midShow = async (context: Harness) => {
  await operator(context.app, "/api/show", { commandId: "save-1", expectedRevision: 0, show: show() }, "PUT");
  await operator(context.app, "/api/transport", {
    commandId: "prep-1", expectedRevision: 1, action: "prepare", showRevision: 1, positionMs: 0, effectiveServerMs: 0,
  });
  const barrier = context.preparations.current("transport")!;
  barrier.acknowledge({
    deviceId: 0, preparationId: barrier.preparationId, ready: true, reason: null,
    showRevision: 1, transportRevision: 1,
  });
  await operator(context.app, "/api/transport", {
    commandId: "play-1", expectedRevision: 1, action: "play", showRevision: 1, positionMs: 0,
    effectiveServerMs: serverMs + 10_000,
  });
  await operator(context.app, "/api/mix", {
    commandId: "mix-1", expectedRevision: 0, masterGain: 1, channels: show().channels,
    effectiveServerMs: serverMs + 10_000,
  });
  await operator(context.app, "/api/assignments", {
    commandId: "assign-1", expectedRevision: 0, mapRevision: 0, deviceIds: [0, 1], channelId: "melody",
    effectiveServerMs: serverMs + 10_000,
  });
};

const panic = (context: Harness, commandId = "panic-1", body: Record<string, unknown> = {}) =>
  operator(context.app, "/api/panic", { commandId, expectedRevision: 0, ...body });

describe("panic", () => {
  test("cancels everything that was scheduled", async () => {
    const context = harness();
    await midShow(context);
    expect(context.state.pendingActions.length).toBe(3);

    const response = await panic(context);

    expect(response.status).toBe(200);
    expect(context.state.pendingActions).toEqual([]);
  });

  test("stops the transport now rather than at a future moment", async () => {
    const context = harness();
    await midShow(context);
    // Let the scheduled start become effective, so playback is genuinely running.
    context.state.applyDue(serverMs + 10_000);
    expect(context.state.transport.status).toBe("playing");

    await panic(context);

    expect(context.state.transport.status).toBe("stopped");
    expect(context.state.transport.positionMs).toBe(0);
  });

  test("reaches every connected phone", async () => {
    const context = harness();
    await midShow(context);
    await panic(context);

    for (const deviceId of [0, 1]) {
      expect(context.sockets.get(deviceId)?.typed("panic")).toHaveLength(1);
    }
  });

  test("is not blocked by a stale revision, because reloading first is not an option", async () => {
    const context = harness();
    await midShow(context);

    const response = await panic(context, "panic-1", { expectedRevision: 999 });
    expect(response.status).toBe(200);
    expect(context.state.transport.status).toBe("stopped");
  });

  test("is not blocked by a stale epoch either", async () => {
    const context = harness();
    await midShow(context);

    const response = await context.app.request("/api/panic", {
      method: "POST",
      headers: { "content-type": "application/json", "x-operator-secret": SECRET },
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: "epoch-from-a-previous-run",
        commandId: "panic-1", expectedRevision: 0,
      }),
    });

    expect(response.status).toBe(200);
    expect(context.state.transport.status).toBe("stopped");
  });

  test("still refuses a panic addressed to another session", async () => {
    const context = harness();
    const response = await context.app.request("/api/panic", {
      method: "POST",
      headers: { "content-type": "application/json", "x-operator-secret": SECRET },
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION, sessionId: "another-session", serverEpoch: EPOCH,
        commandId: "panic-1", expectedRevision: 0,
      }),
    });
    expect(response.status).toBe(404);
  });

  test("requires the operator secret", async () => {
    const context = harness();
    const response = await context.app.request("/api/panic", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: EPOCH,
        commandId: "panic-1", expectedRevision: 0,
      }),
    });
    expect(response.status).toBe(401);
  });

  test("a retry does not fire a second time", async () => {
    const context = harness();
    await midShow(context);
    const first = CommandAccepted.parse(await (await panic(context)).json());
    const revisionAfterFirst = context.state.transport.transportRevision;

    const retry = CommandAccepted.parse(await (await panic(context)).json());

    expect(retry).toEqual(first);
    expect(context.state.transport.transportRevision).toBe(revisionAfterFirst);
  });
});

describe("the audio lease", () => {
  test("grants permission in short slices that keep moving forward", () => {
    const lease = new AudioLease();
    const first = lease.renew(1_000_000);
    const second = lease.renew(1_001_000);

    expect(first).toBe(1_000_000 + LEASE_DURATION_MS);
    expect(second).toBeGreaterThan(first!);
  });

  test("survives a lost renewal, because one hiccup must not mute a piece", () => {
    const lease = new AudioLease();
    const expiry = lease.renew(1_000_000)!;
    // Renewals are a second apart, so several have to be lost before the expiry passes.
    expect(expiry - 1_000_000).toBeGreaterThanOrEqual(lease.renewIntervalMs * 4);
  });

  test("panic suspends it, so a phone that missed the broadcast still falls silent", async () => {
    const context = harness();
    await midShow(context);
    await panic(context);

    expect(context.lease.isSuspended).toBe(true);
    expect(context.lease.renew(serverMs + 1000)).toBeNull();
    // The panic itself also tells every phone its permission has ended right now.
    const expiry = context.sockets.get(0)!.typed("lease.renew");
    expect(expiry).toHaveLength(1);
    if (expiry[0].type !== "lease.renew") throw new Error("expected lease.renew");
    expect(expiry[0].payload.expiresServerMs).toBe(serverMs);
  });

  test("a deliberate transport command is how an operator comes back", async () => {
    const context = harness();
    await midShow(context);
    await panic(context);
    expect(context.lease.isSuspended).toBe(true);

    await operator(context.app, "/api/transport", {
      commandId: "stop-after-panic", expectedRevision: context.state.transport.transportRevision,
      action: "stop", showRevision: 1, positionMs: 0, effectiveServerMs: serverMs + DEFAULT_LEAD_TIME_MS,
    });

    expect(context.lease.isSuspended).toBe(false);
    expect(context.lease.renew(serverMs)).toBeGreaterThan(serverMs);
  });
});
