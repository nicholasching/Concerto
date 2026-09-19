import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import {
  AdminSnapshot, ApiError, ClientMessage, CommandAccepted, PROTOCOL_VERSION, ServerMessage, type ShowData,
} from "@orchestra/contracts";
import { createApp, DEFAULT_LEAD_TIME_MS } from "../src/app";
import { AssetStore } from "../src/assets";
import { CalibrationRuns } from "../src/calibration";
import { JobRunner } from "../src/jobs";
import { AudioLease } from "../src/lease";
import { Barrier } from "../src/barriers";
import { CheckpointStore } from "../src/checkpoint";
import type { ServerClock } from "../src/clock";
import { CommandLog } from "../src/commands";
import { ConnectionRegistry, type ClientSocket } from "../src/connections";
import { handleClientMessage } from "../src/messages";
import { Preparations } from "../src/preparations";
import { DeviceRegistry } from "../src/registry";
import { RateLimiter } from "../src/rate-limit";
import { SessionState } from "../src/state";
import { positionAt } from "../src/transport";

const SESSION = "session-under-test";
const SECRET = "operator-secret-for-tests";
const EPOCH = "epoch-a";

let directory: string;
let serverMs: number;

beforeEach(async () => {
  directory = await mkdtemp(joinPath(tmpdir(), "orchestra-transport-"));
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
  messagesOfType(type: string) {
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
  const preparations = new Preparations();
  const connections = new ConnectionRegistry();
  const app = createApp({
    clock, state, preparations, connections, operatorSecret: SECRET,
    registry: new DeviceRegistry(),
    store: new CheckpointStore(joinPath(directory, "checkpoint.json")),
    joins: new RateLimiter(100, 100, () => serverMs),
    commands: new CommandLog(),
    assets: new AssetStore(joinPath(directory, "assets")),
    uploads: new AssetStore(joinPath(directory, "uploads")),
    calibrations: new CalibrationRuns(),
    jobs: new JobRunner(),
    lease: new AudioLease(),
    jobWorkspace: joinPath(directory, "jobs"),
  });
  return { app, state, preparations, connections, clock };
};

const command = (app: ReturnType<typeof createApp>, path: string, body: Record<string, unknown>) =>
  app.request(path, {
    method: path === "/api/show" ? "PUT" : "POST",
    headers: { "content-type": "application/json", "x-operator-secret": SECRET },
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: EPOCH, ...body }),
  });

const transport = (app: ReturnType<typeof createApp>, body: {
  commandId: string; action: string; expectedRevision: number; showRevision: number;
  positionMs?: number; effectiveServerMs?: number;
}) =>
  command(app, "/api/transport", {
    positionMs: 0, effectiveServerMs: serverMs + DEFAULT_LEAD_TIME_MS, ...body,
  });

// A session with a saved show and two connected phones holding sockets.
const prepared = async () => {
  const context = harness();
  await command(context.app, "/api/show", { commandId: "save-1", expectedRevision: 0, show: show() });
  const sockets = new Map<number, FakeSocket>();
  for (const deviceId of [0, 1]) {
    context.state.register(deviceId);
    context.state.setConnected(deviceId, true);
    const socket = new FakeSocket();
    sockets.set(deviceId, socket);
    context.connections.bindParticipant(deviceId, socket);
  }
  return { ...context, sockets };
};

const acknowledge = (context: Awaited<ReturnType<typeof prepared>>, deviceId: number, options: {
  preparationId: string; ready?: boolean; showRevision?: number; transportRevision?: number;
}) =>
  handleClientMessage({
    raw: JSON.stringify(ClientMessage.parse({
      protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: EPOCH, messageId: `ack-${deviceId}`,
      type: "transport.ready",
      payload: {
        preparationId: options.preparationId, ready: options.ready ?? true, reason: null,
        showRevision: options.showRevision ?? context.state.showRevision,
        transportRevision: options.transportRevision ?? context.state.transport.transportRevision,
      },
    })),
    receivedServerMs: serverMs, clock: context.clock, deviceId,
    state: context.state, preparations: context.preparations,
  });

const preparationIdOf = (context: Awaited<ReturnType<typeof prepared>>) => {
  const barrier = context.preparations.current("transport");
  if (!barrier) throw new Error("expected an active preparation");
  return barrier.preparationId;
};

describe("preparation barriers", () => {
  test("only phones that acknowledge this preparation are counted ready", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "prep-1", action: "prepare", expectedRevision: 1, showRevision: 1 });
    const preparationId = preparationIdOf(context);

    acknowledge(context, 0, { preparationId });

    expect(context.preparations.current("transport")?.counts()).toEqual({ expected: 2, ready: 1, pending: 1, excluded: 0 });
  });

  test("an acknowledgement for a superseded preparation does not count", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "prep-1", action: "prepare", expectedRevision: 1, showRevision: 1 });
    const stale = preparationIdOf(context);
    await transport(context.app, { commandId: "prep-2", action: "prepare", expectedRevision: 1, showRevision: 1 });

    const reply = acknowledge(context, 0, { preparationId: stale });

    if (reply.type !== "error") throw new Error("expected an error");
    expect(reply.payload.error.code).toBe("STALE_PREPARATION");
    expect(context.preparations.current("transport")?.counts().ready).toBe(0);
  });

  test("an acknowledgement naming the wrong show revision does not count", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "prep-1", action: "prepare", expectedRevision: 1, showRevision: 1 });

    const reply = acknowledge(context, 0, { preparationId: preparationIdOf(context), showRevision: 99 });

    expect(reply.type).toBe("error");
    expect(context.preparations.current("transport")?.counts().ready).toBe(0);
  });

  test("a phone that never answers is reported pending and does not block the others", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "prep-1", action: "prepare", expectedRevision: 1, showRevision: 1 });
    acknowledge(context, 0, { preparationId: preparationIdOf(context) });

    const response = await transport(context.app, {
      commandId: "play-1", action: "play", expectedRevision: 1, showRevision: 1,
    });

    expect(response.status).toBe(200);
    expect(context.preparations.current("transport")?.counts()).toMatchObject({ ready: 1, pending: 1 });
  });

  test("a phone that reports not ready is excluded with its reason", () => {
    const barrier = new Barrier("prep-1", 1, 1, [0, 1]);
    barrier.acknowledge({ deviceId: 0, preparationId: "prep-1", ready: false, reason: "audio locked", showRevision: 1, transportRevision: 1 });

    expect(barrier.excludedDevices()).toEqual([{ deviceId: 0, reason: "audio locked" }]);
    expect(barrier.counts()).toEqual({ expected: 2, ready: 0, pending: 1, excluded: 1 });
  });

  test("a disconnect excludes the device so nothing waits on it", () => {
    const barrier = new Barrier("prep-1", 1, 1, [0, 1]);
    barrier.acknowledge({ deviceId: 0, preparationId: "prep-1", ready: true, reason: null, showRevision: 1, transportRevision: 1 });
    barrier.exclude(0, "disconnected");

    expect(barrier.readyDevices()).toEqual([]);
    expect(barrier.counts()).toMatchObject({ ready: 0, excluded: 1 });
  });
});

describe("scheduled transport", () => {
  test("playback starts at a future moment, not at receipt time", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "prep-1", action: "prepare", expectedRevision: 1, showRevision: 1 });
    acknowledge(context, 0, { preparationId: preparationIdOf(context) });
    const effectiveServerMs = serverMs + 5000;

    await transport(context.app, { commandId: "play-1", action: "play", expectedRevision: 1, showRevision: 1, effectiveServerMs });

    const pending = context.state.pendingIn("transport");
    if (pending?.domain !== "transport") throw new Error("expected a pending transport action");
    expect(pending.effectiveServerMs).toBe(effectiveServerMs);
    expect(pending.transport).toMatchObject({ status: "playing", startServerMs: effectiveServerMs });
    expect(context.state.transport.status).toBe("stopped");
  });

  test("the pending action becomes effective at its moment and not before", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "prep-1", action: "prepare", expectedRevision: 1, showRevision: 1 });
    acknowledge(context, 0, { preparationId: preparationIdOf(context) });
    const effectiveServerMs = serverMs + 5000;
    await transport(context.app, { commandId: "play-1", action: "play", expectedRevision: 1, showRevision: 1, effectiveServerMs });

    context.state.applyDue(effectiveServerMs - 1);
    expect(context.state.transport.status).toBe("stopped");

    context.state.applyDue(effectiveServerMs);
    expect(context.state.transport).toMatchObject({ status: "playing", startServerMs: effectiveServerMs });
    expect(context.state.pendingActions).toHaveLength(0);
  });

  test("refuses a cue too close to now for phones to schedule it", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "prep-1", action: "prepare", expectedRevision: 1, showRevision: 1 });
    acknowledge(context, 0, { preparationId: preparationIdOf(context) });

    const response = await transport(context.app, {
      commandId: "play-1", action: "play", expectedRevision: 1, showRevision: 1,
      effectiveServerMs: serverMs + DEFAULT_LEAD_TIME_MS - 1,
    });

    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("INSUFFICIENT_LEAD_TIME");
    expect(context.state.pendingActions).toHaveLength(0);
  });

  test("refuses a command minted under a previous epoch", async () => {
    const context = await prepared();
    const response = await context.app.request("/api/transport", {
      method: "POST",
      headers: { "content-type": "application/json", "x-operator-secret": SECRET },
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: "epoch-from-previous-run",
        commandId: "play-1", expectedRevision: 1, action: "play", showRevision: 1, positionMs: 0,
        effectiveServerMs: serverMs + DEFAULT_LEAD_TIME_MS,
      }),
    });

    expect(response.status).toBe(409);
    const error = ApiError.parse(await response.json());
    expect(error.error).toMatchObject({ code: "STALE_EPOCH", retryable: true });
  });

  test("refuses playback that was never prepared", async () => {
    const context = await prepared();
    const response = await transport(context.app, { commandId: "play-1", action: "play", expectedRevision: 1, showRevision: 1 });

    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("NOT_PREPARED");
  });

  test("refuses playback when nobody acknowledged", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "prep-1", action: "prepare", expectedRevision: 1, showRevision: 1 });

    const response = await transport(context.app, { commandId: "play-1", action: "play", expectedRevision: 1, showRevision: 1 });

    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("NOBODY_READY");
  });

  test("stopping needs no preparation, because a stop must never wait on a silent phone", async () => {
    const context = await prepared();
    const response = await transport(context.app, { commandId: "stop-1", action: "stop", expectedRevision: 1, showRevision: 1 });

    expect(response.status).toBe(200);
    expect(context.state.pendingIn("transport")).toBeDefined();
  });

  test("only phones that acknowledged receive the start cue", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "prep-1", action: "prepare", expectedRevision: 1, showRevision: 1 });
    acknowledge(context, 0, { preparationId: preparationIdOf(context) });

    await transport(context.app, { commandId: "play-1", action: "play", expectedRevision: 1, showRevision: 1 });

    expect(context.sockets.get(0)?.messagesOfType("transport.commit")).toHaveLength(1);
    expect(context.sockets.get(1)?.messagesOfType("transport.commit")).toHaveLength(0);
    expect(context.sockets.get(1)?.messagesOfType("transport.prepare")).toHaveLength(1);
  });

  test("a phone that missed the broadcast finds the same cue in its snapshot", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "prep-1", action: "prepare", expectedRevision: 1, showRevision: 1 });
    acknowledge(context, 0, { preparationId: preparationIdOf(context) });
    const effectiveServerMs = serverMs + 5000;
    await transport(context.app, { commandId: "play-1", action: "play", expectedRevision: 1, showRevision: 1, effectiveServerMs });

    const snapshot = context.state.participantSnapshot(0, context.clock);
    const pending = snapshot?.pendingActions[0];
    if (pending?.domain !== "transport") throw new Error("expected a pending transport action in the snapshot");
    expect(pending.effectiveServerMs).toBe(effectiveServerMs);
    expect(pending.transport.startServerMs).toBe(effectiveServerMs);
    expect(context.state.participantSnapshot(1, context.clock)?.pendingActions).toHaveLength(0);
  });

  test("replacing a pending change in one domain names the command it superseded", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "stop-1", action: "stop", expectedRevision: 1, showRevision: 1 });
    await transport(context.app, { commandId: "stop-2", action: "stop", expectedRevision: 2, showRevision: 1 });

    expect(context.state.pendingIn("transport")).toMatchObject({ commandId: "stop-2", supersedesCommandId: "stop-1" });
    expect(context.state.pendingActions).toHaveLength(1);
    expect(context.state.pendingIn("transport")).toMatchObject({ transport: { transportRevision: 3 } });
  });

  test("a retried transport command schedules once", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "prep-1", action: "prepare", expectedRevision: 1, showRevision: 1 });
    acknowledge(context, 0, { preparationId: preparationIdOf(context) });
    const first = CommandAccepted.parse(await (await transport(context.app, {
      commandId: "play-1", action: "play", expectedRevision: 1, showRevision: 1,
    })).json());
    const retry = CommandAccepted.parse(await (await transport(context.app, {
      commandId: "play-1", action: "play", expectedRevision: 1, showRevision: 1,
    })).json());

    expect(retry).toEqual(first);
    expect(context.state.pendingActions).toHaveLength(1);
  });

  test("the operator snapshot shows the pending cue before it fires", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "prep-1", action: "prepare", expectedRevision: 1, showRevision: 1 });
    acknowledge(context, 0, { preparationId: preparationIdOf(context) });
    await transport(context.app, { commandId: "play-1", action: "play", expectedRevision: 1, showRevision: 1 });

    const snapshot = AdminSnapshot.parse(await (await context.app.request(`/api/sessions/${SESSION}/snapshot`, {
      headers: { "x-operator-secret": SECRET },
    })).json());

    expect(snapshot.pendingActions).toHaveLength(1);
    expect(snapshot.transport.status).toBe("stopped");
  });
});

describe("playhead arithmetic", () => {
  test("a paused transport keeps its position", () => {
    expect(positionAt({ status: "paused", transportRevision: 1, showRevision: 1, positionMs: 4200, startServerMs: null }, 9_999_999)).toBe(4200);
  });

  test("a playing transport advances with the server clock", () => {
    const playing = { status: "playing", transportRevision: 1, showRevision: 1, positionMs: 1000, startServerMs: 5000 } as const;
    expect(positionAt(playing, 8000)).toBe(4000);
  });

  test("pausing captures the playhead at the effective moment, not at receipt", async () => {
    const context = await prepared();
    await transport(context.app, { commandId: "prep-1", action: "prepare", expectedRevision: 1, showRevision: 1 });
    acknowledge(context, 0, { preparationId: preparationIdOf(context) });
    const startAt = serverMs + 5000;
    await transport(context.app, { commandId: "play-1", action: "play", expectedRevision: 1, showRevision: 1, effectiveServerMs: startAt });
    context.state.applyDue(startAt);

    const pauseAt = startAt + 10_000;
    serverMs = startAt + 1000;
    await transport(context.app, {
      commandId: "pause-1", action: "pause", expectedRevision: context.state.transport.transportRevision,
      showRevision: 1, effectiveServerMs: pauseAt,
    });
    context.state.applyDue(pauseAt);

    expect(context.state.transport).toMatchObject({ status: "paused", positionMs: 10_000 });
  });
});
