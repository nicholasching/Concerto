import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { ApiError, CommandAccepted, ParticipantSnapshot, PROTOCOL_VERSION, ServerMessage, type ShowData } from "@orchestra/contracts";
import { createApp, DEFAULT_LEAD_TIME_MS } from "../src/app";
import { AssetStore } from "../src/assets";
import { CalibrationRuns } from "../src/calibration";
import { JobRunner } from "../src/jobs";
import { AudioLease } from "../src/lease";
import { CheckpointStore } from "../src/checkpoint";
import type { ServerClock } from "../src/clock";
import { CommandLog } from "../src/commands";
import { ConnectionRegistry, type ClientSocket } from "../src/connections";
import { Preparations } from "../src/preparations";
import { DeviceRegistry } from "../src/registry";
import { RateLimiter } from "../src/rate-limit";
import { SessionState } from "../src/state";
import { handleClientMessage } from "../src/messages";

const SESSION = "session-under-test";
const SECRET = "operator-secret-for-tests";
const EPOCH = "epoch-a";

let directory: string;
let serverMs: number;

beforeEach(async () => {
  directory = await mkdtemp(joinPath(tmpdir(), "orchestra-assign-"));
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
  channels: [
    { channelId: "melody", label: "Melody", color: "#3b82f6", gain: 1, mute: false, solo: false },
    { channelId: "bass", label: "Bass", color: "#ef4444", gain: 1, mute: false, solo: false },
  ],
  clips: [{ clipId: "clip-1", channelId: "melody", trackId: "track-1", timelineStartMs: 0, sourceOffsetMs: 0, durationMs: 60_000, gain: 1 }],
});

const prepared = async () => {
  const clock: ServerClock = { sessionId: SESSION, serverEpoch: EPOCH, nowServerMs: () => serverMs };
  const state = new SessionState();
  const connections = new ConnectionRegistry();
  const preparations = new Preparations();
  const app = createApp({
    clock, state, connections, operatorSecret: SECRET,
    registry: new DeviceRegistry(),
    store: new CheckpointStore(joinPath(directory, "checkpoint.json")),
    joins: new RateLimiter(100, 100, () => serverMs),
    commands: new CommandLog(),
    preparations,
    assets: new AssetStore(joinPath(directory, "assets")),
    uploads: new AssetStore(joinPath(directory, "uploads")),
    calibrations: new CalibrationRuns(),
    jobs: new JobRunner(),
    lease: new AudioLease(),
    jobWorkspace: joinPath(directory, "jobs"),
  });
  await app.request("/api/show", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-operator-secret": SECRET },
    body: JSON.stringify({
      protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: EPOCH,
      commandId: "save-1", expectedRevision: 0, show: show(),
    }),
  });
  const sockets = new Map<number, FakeSocket>();
  for (const deviceId of [0, 1, 2]) {
    state.register(deviceId);
    state.setConnected(deviceId, true);
    const socket = new FakeSocket();
    sockets.set(deviceId, socket);
    connections.bindParticipant(deviceId, socket);
  }
  return { app, state, connections, clock, sockets, preparations };
};

const assign = (app: Awaited<ReturnType<typeof prepared>>["app"], body: {
  commandId: string; expectedRevision: number; deviceIds: number[]; channelId: string | null;
  mapRevision?: number; effectiveServerMs?: number; preparationId?: string;
}) =>
  app.request("/api/assignments", {
    method: "POST",
    headers: { "content-type": "application/json", "x-operator-secret": SECRET },
    body: JSON.stringify({
      protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: EPOCH,
      mapRevision: 0, effectiveServerMs: serverMs + DEFAULT_LEAD_TIME_MS, ...body,
    }),
  });

const mix = (app: Awaited<ReturnType<typeof prepared>>["app"], body: {
  commandId: string; expectedRevision: number; masterGain?: number; effectiveServerMs?: number;
  channels?: ShowData["channels"];
}) =>
  app.request("/api/mix", {
    method: "POST",
    headers: { "content-type": "application/json", "x-operator-secret": SECRET },
    body: JSON.stringify({
      protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: EPOCH,
      masterGain: 1, channels: show().channels, effectiveServerMs: serverMs + DEFAULT_LEAD_TIME_MS, ...body,
    }),
  });

describe("assignments", () => {
  test("a live switch requires matching preparation and excludes phones missing the new channel", async () => {
    const context = await prepared();
    context.state.scheduleTransport({ domain: "transport", commandId: "playing", effectiveServerMs: serverMs,
      supersedesCommandId: null, transport: { status: "playing", transportRevision: 2, showRevision: 1, positionMs: 0, startServerMs: serverMs } }, [0, 1, 2]);
    context.state.applyDue(serverMs);
    const body = { commandId: "switch", expectedRevision: 0, mapRevision: 0, deviceIds: [0, 1], channelId: "melody", effectiveServerMs: serverMs + 5000 };
    expect((await assign(context.app, body)).status).toBe(409);
    const response = await context.app.request("/api/assignments/prepare", { method: "POST", headers: { "content-type": "application/json", "x-operator-secret": SECRET },
      body: JSON.stringify({ protocolVersion: 1, sessionId: SESSION, serverEpoch: EPOCH, ...body, commandId: "prepare-switch" }) });
    const prep = CommandAccepted.parse(await response.json());
    for (const deviceId of [0, 1]) handleClientMessage({ clock: context.clock, receivedServerMs: serverMs, state: context.state, preparations: context.preparations, deviceId,
      raw: JSON.stringify({ protocolVersion: 1, sessionId: SESSION, serverEpoch: EPOCH, messageId: `ack-${deviceId}`, type: "assignment.ready",
        payload: { preparationId: prep.preparationId, assignmentRevision: 1, ready: deviceId === 0, reason: deviceId === 0 ? null : "assets-missing" } }) });
    const accepted = CommandAccepted.parse(await (await assign(context.app, { ...body, preparationId: prep.preparationId })).json());
    expect(accepted.ready).toBe(1); expect(accepted.excluded).toEqual([{ deviceId: 1, reason: "assets-missing" }]);
    context.state.applyDue(body.effectiveServerMs); expect(context.state.channelMembers("melody")).toEqual([0]);
    expect(CommandAccepted.parse(await (await assign(context.app, { ...body, preparationId: prep.preparationId })).json())).toEqual(accepted);
  });
  test("a phone joins a channel by being assigned, and membership is server-owned", async () => {
    const context = await prepared();
    const effectiveServerMs = serverMs + 5000;
    await assign(context.app, { commandId: "assign-1", expectedRevision: 0, deviceIds: [0, 1], channelId: "melody", effectiveServerMs });

    expect(context.state.channelMembers("melody")).toEqual([]);
    context.state.applyDue(effectiveServerMs);
    expect(context.state.channelMembers("melody")).toEqual([0, 1]);
    expect(context.state.channelMembers("bass")).toEqual([]);
  });

  test("each phone is told only about its own assignment", async () => {
    const context = await prepared();
    await assign(context.app, { commandId: "assign-1", expectedRevision: 0, deviceIds: [0, 1], channelId: "melody" });

    const delivered = context.sockets.get(0)?.typed("assignment.commit") ?? [];
    expect(delivered).toHaveLength(1);
    const payload = delivered[0];
    if (payload.type !== "assignment.commit") throw new Error("expected an assignment.commit");
    expect(payload.payload.assignments.map(a => a.deviceId)).toEqual([0]);
    expect(context.sockets.get(2)?.typed("assignment.commit")).toHaveLength(0);
  });

  test("a participant snapshot carries only that device's assignment", async () => {
    const context = await prepared();
    const effectiveServerMs = serverMs + 5000;
    await assign(context.app, { commandId: "assign-1", expectedRevision: 0, deviceIds: [0], channelId: "melody", effectiveServerMs });
    context.state.applyDue(effectiveServerMs);

    const snapshot = ParticipantSnapshot.parse(context.state.participantSnapshot(1, context.clock));
    expect(snapshot.assignment).toMatchObject({ deviceId: 1, channelId: null });
    expect(JSON.stringify(snapshot)).not.toContain("\"melody\",\"assignmentRevision\":1");
  });

  test("reassigning one device cancels only that device's pending change", async () => {
    const context = await prepared();
    const first = serverMs + 5000;
    await assign(context.app, { commandId: "assign-1", expectedRevision: 0, deviceIds: [0, 1], channelId: "melody", effectiveServerMs: first });
    await assign(context.app, { commandId: "assign-2", expectedRevision: 1, deviceIds: [1], channelId: "bass", effectiveServerMs: first });

    expect(context.state.pendingAssignmentFor(0)).toMatchObject({ commandId: "assign-1" });
    expect(context.state.pendingAssignmentFor(1)).toMatchObject({ commandId: "assign-2", supersedesCommandId: "assign-1" });

    context.state.applyDue(first);
    expect(context.state.channelMembers("melody")).toEqual([0]);
    expect(context.state.channelMembers("bass")).toEqual([1]);
  });

  test("the last committed assignment wins for overlapping selections", async () => {
    const context = await prepared();
    const effectiveServerMs = serverMs + 5000;
    await assign(context.app, { commandId: "assign-1", expectedRevision: 0, deviceIds: [0, 1, 2], channelId: "melody", effectiveServerMs });
    await assign(context.app, { commandId: "assign-2", expectedRevision: 1, deviceIds: [1, 2], channelId: "bass", effectiveServerMs });
    context.state.applyDue(effectiveServerMs);

    expect(context.state.channelMembers("melody")).toEqual([0]);
    expect(context.state.channelMembers("bass")).toEqual([1, 2]);
  });

  test("refuses a selection built against a stale audience map", async () => {
    const context = await prepared();
    const response = await assign(context.app, {
      commandId: "assign-1", expectedRevision: 0, deviceIds: [0], channelId: "melody", mapRevision: 7,
    });

    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("STALE_MAP");
  });

  test("refuses a channel that is not in the show", async () => {
    const context = await prepared();
    const response = await assign(context.app, { commandId: "assign-1", expectedRevision: 0, deviceIds: [0], channelId: "percussion" });

    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("UNKNOWN_CHANNEL");
  });

  test("refuses a device that never joined", async () => {
    const context = await prepared();
    const response = await assign(context.app, { commandId: "assign-1", expectedRevision: 0, deviceIds: [0, 99], channelId: "melody" });

    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("UNKNOWN_DEVICE");
    expect(context.state.pendingAssignmentFor(0)).toBeUndefined();
  });

  test("unassigning is explicit, and an unassigned device stays silent", async () => {
    const context = await prepared();
    const effectiveServerMs = serverMs + 5000;
    await assign(context.app, { commandId: "assign-1", expectedRevision: 0, deviceIds: [0], channelId: "melody", effectiveServerMs });
    context.state.applyDue(effectiveServerMs);
    await assign(context.app, { commandId: "assign-2", expectedRevision: 1, deviceIds: [0], channelId: null, effectiveServerMs: effectiveServerMs + 5000 });
    context.state.applyDue(effectiveServerMs + 5000);

    expect(context.state.assignmentOf(0)?.channelId).toBeNull();
    expect(context.state.channelMembers("melody")).toEqual([]);
  });

  test("requires the operator secret", async () => {
    const context = await prepared();
    const response = await context.app.request("/api/assignments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: EPOCH, commandId: "assign-1",
        expectedRevision: 0, mapRevision: 0, deviceIds: [0], channelId: "melody", effectiveServerMs: serverMs + DEFAULT_LEAD_TIME_MS,
      }),
    });
    expect(response.status).toBe(401);
  });
});

describe("mix", () => {
  test("empty, missing, or duplicate channel sets cannot corrupt the authoritative show", async () => {
    const context = await prepared();
    for (const channels of [[], [show().channels[0]], [show().channels[0], show().channels[0]]]) {
      const response = await mix(context.app, { commandId: crypto.randomUUID(), expectedRevision: 0, channels });
      expect(response.status).toBe(400); expect((await response.json()).error.code).toBe("INVALID_MIX");
    }
    expect(context.state.pendingActions).toEqual([]);
    expect(context.state.adminSnapshot(context.clock).show.channels).toHaveLength(2);
  });
  test("a mix change applies at its moment without touching asset timing", async () => {
    const context = await prepared();
    const effectiveServerMs = serverMs + 5000;
    const quieter = show().channels.map(channel => ({ ...channel, gain: 0.4 }));
    await mix(context.app, { commandId: "mix-1", expectedRevision: 0, channels: quieter, masterGain: 0.8, effectiveServerMs });

    expect(context.state.show.channels[0].gain).toBe(1);
    context.state.applyDue(effectiveServerMs);
    expect(context.state.show.channels.map(channel => channel.gain)).toEqual([0.4, 0.4]);
    expect(context.state.masterGain).toBe(0.8);
    expect(context.state.show.clips[0]).toMatchObject({ timelineStartMs: 0, sourceOffsetMs: 0, durationMs: 60_000 });
  });

  test("a newer mix does not cancel an accepted transport start", async () => {
    const context = await prepared();
    // Schedule a stop, which needs no preparation, then a mix change afterwards.
    await context.app.request("/api/transport", {
      method: "POST",
      headers: { "content-type": "application/json", "x-operator-secret": SECRET },
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: EPOCH, commandId: "stop-1",
        expectedRevision: 1, action: "stop", showRevision: 1, positionMs: 0,
        effectiveServerMs: serverMs + DEFAULT_LEAD_TIME_MS,
      }),
    });
    expect(context.state.pendingIn("transport")).toBeDefined();

    await mix(context.app, { commandId: "mix-1", expectedRevision: 0 });

    expect(context.state.pendingIn("transport")).toMatchObject({ commandId: "stop-1" });
    expect(context.state.pendingIn("mix")).toMatchObject({ commandId: "mix-1" });
  });

  test("replacing a pending mix names the command it superseded", async () => {
    const context = await prepared();
    await mix(context.app, { commandId: "mix-1", expectedRevision: 0 });
    await mix(context.app, { commandId: "mix-2", expectedRevision: 1 });

    expect(context.state.pendingIn("mix")).toMatchObject({ commandId: "mix-2", supersedesCommandId: "mix-1" });
  });

  test("a retried mix command schedules once", async () => {
    const context = await prepared();
    const first = CommandAccepted.parse(await (await mix(context.app, { commandId: "mix-1", expectedRevision: 0 })).json());
    const retry = CommandAccepted.parse(await (await mix(context.app, { commandId: "mix-1", expectedRevision: 0 })).json());

    expect(retry).toEqual(first);
    expect(context.state.pendingActions.filter(action => action.domain === "mix")).toHaveLength(1);
  });

  test("every connected phone is told about a mix change", async () => {
    const context = await prepared();
    await mix(context.app, { commandId: "mix-1", expectedRevision: 0 });

    for (const deviceId of [0, 1, 2]) {
      expect(context.sockets.get(deviceId)?.typed("mix.commit")).toHaveLength(1);
    }
  });
});
