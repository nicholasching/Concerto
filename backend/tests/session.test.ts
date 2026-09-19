import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { AdminSnapshot, ApiError, JoinResponse, ParticipantSnapshot, PROTOCOL_VERSION, ClientMessage } from "@orchestra/contracts";
import { createApp } from "../src/app";
import { matchesOperatorSecret } from "../src/auth";
import { CheckpointStore } from "../src/checkpoint";
import type { ServerClock } from "../src/clock";
import { ConnectionRegistry, OperatorTelemetry, REPLACED_CODE, type ClientSocket } from "../src/connections";
import { handleClientMessage } from "../src/messages";
import { DeviceRegistry } from "../src/registry";
import { RateLimiter } from "../src/rate-limit";
import { SessionState } from "../src/state";

const SESSION = "session-under-test";
const SECRET = "operator-secret-for-tests";
const serverMs = 1_000_000;
const clock: ServerClock = { sessionId: SESSION, serverEpoch: "epoch-a", nowServerMs: () => serverMs };

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(joinPath(tmpdir(), "orchestra-session-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const harness = () => {
  const registry = new DeviceRegistry();
  const state = new SessionState();
  const app = createApp({
    clock, registry, state, operatorSecret: SECRET,
    store: new CheckpointStore(joinPath(directory, "checkpoint.json")),
    joins: new RateLimiter(100, 100, () => serverMs),
  });
  return { app, registry, state };
};

const join = async (app: ReturnType<typeof createApp>) =>
  JoinResponse.parse(
    await (
      await app.request(`/api/sessions/${SESSION}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).json(),
  );

const snapshot = (app: ReturnType<typeof createApp>, headers: Record<string, string>) =>
  app.request(`/api/sessions/${SESSION}/snapshot`, { headers });

class FakeSocket implements ClientSocket {
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
  }
}

describe("role-filtered snapshots", () => {
  test("a participant sees its own state and no other phone's telemetry", async () => {
    const { app } = harness();
    const first = await join(app);
    await join(app);

    const body = await (await snapshot(app, { "x-resume-token": first.resumeToken })).json();
    const parsed = ParticipantSnapshot.parse(body);

    expect(parsed.role).toBe("participant");
    expect(parsed.deviceId).toBe(first.deviceId);
    expect(parsed.location.status).toBe("unseen");
    expect(parsed.assignment.channelId).toBeNull();
    expect(JSON.stringify(body)).not.toContain("\"devices\"");
  });

  test("an operator with the secret sees every device", async () => {
    const { app } = harness();
    await join(app);
    await join(app);

    const parsed = AdminSnapshot.parse(await (await snapshot(app, { "x-operator-secret": SECRET })).json());

    expect(parsed.role).toBe("admin");
    expect(parsed.devices.map(device => device.deviceId)).toEqual([0, 1]);
    expect(parsed.audienceMap.locations).toHaveLength(2);
    expect(parsed.show.channels).toHaveLength(1);
  });

  test("a participant token cannot obtain the operator view", async () => {
    const { app } = harness();
    const participant = await join(app);

    const response = await snapshot(app, { "x-operator-secret": participant.resumeToken });
    expect(response.status).toBe(401);
    expect(ApiError.parse(await response.json()).error.code).toBe("UNAUTHORIZED");
  });

  test("an unauthenticated request gets nothing", async () => {
    const { app } = harness();
    await join(app);
    expect((await snapshot(app, {})).status).toBe(401);
  });

  test("an unset operator secret refuses operators instead of admitting everyone", () => {
    expect(matchesOperatorSecret(SECRET, undefined)).toBe(false);
    expect(matchesOperatorSecret("", "")).toBe(false);
    expect(matchesOperatorSecret(SECRET, SECRET)).toBe(true);
    expect(matchesOperatorSecret("wrong", SECRET)).toBe(false);
  });
});

describe("device status over a bound socket", () => {
  const statusMessage = (deviceId: number, overrides: Record<string, unknown> = {}) =>
    JSON.stringify(
      ClientMessage.parse({
        protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: "epoch-a", messageId: "status-1",
        type: "device.status",
        payload: {
          deviceId, connected: true, foreground: true, clockReady: true,
          clockUncertaintyMs: 4, clockSampleAgeMs: 120, audioUnlocked: false, decodedTrackHashes: {}, ...overrides,
        },
      }),
    );

  test("readiness fields move independently and come back in the snapshot", () => {
    const state = new SessionState();
    state.register(3);

    const reply = handleClientMessage({
      raw: statusMessage(3, { audioUnlocked: true, clockReady: false, clockUncertaintyMs: null }),
      receivedServerMs: serverMs, clock, deviceId: 3, state,
    });

    if (reply.type !== "state.snapshot") throw new Error("expected a state.snapshot");
    const parsed = ParticipantSnapshot.parse(reply.payload);
    expect(parsed.readiness).toMatchObject({ audioUnlocked: true, clockReady: false, foreground: true });
  });

  test("a socket cannot report status for a device it did not authenticate as", () => {
    const state = new SessionState();
    state.register(3);
    state.register(4);

    const reply = handleClientMessage({
      raw: statusMessage(4), receivedServerMs: serverMs, clock, deviceId: 3, state,
    });

    if (reply.type !== "error") throw new Error("expected an error");
    expect(reply.payload.error.code).toBe("DEVICE_MISMATCH");
    expect(state.readinessOf(4)?.connected).toBe(false);
  });

  test("a disconnect clears what the phone last claimed about itself", () => {
    const state = new SessionState();
    state.register(3);
    handleClientMessage({ raw: statusMessage(3, { audioUnlocked: true }), receivedServerMs: serverMs, clock, deviceId: 3, state });
    state.setConnected(3, true);

    state.setConnected(3, false);

    expect(state.readinessOf(3)).toMatchObject({ connected: false, audioUnlocked: false, clockReady: false });
  });

  test("the revision advances on every state change so a consumer can reject stale data", () => {
    const state = new SessionState();
    const revisions = [state.revision];
    state.register(0);
    revisions.push(state.revision);
    state.setConnected(0, true);
    revisions.push(state.revision);

    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(new Set(revisions).size).toBe(revisions.length);
  });
});

describe("one socket per identity", () => {
  test("a second connection replaces the first", () => {
    const connections = new ConnectionRegistry();
    const first = new FakeSocket();
    const second = new FakeSocket();

    connections.bindParticipant(7, first);
    connections.bindParticipant(7, second);

    expect(first.closedWith?.code).toBe(REPLACED_CODE);
    expect(connections.participantSocket(7)).toBe(second);
  });

  test("the replaced socket's late close does not mark the device offline", () => {
    const connections = new ConnectionRegistry();
    const state = new SessionState();
    state.register(7);
    const first = new FakeSocket();
    const second = new FakeSocket();

    connections.bindParticipant(7, first);
    connections.bindParticipant(7, second);
    state.setConnected(7, true);

    // The old socket's close event arrives after the new one is already bound.
    expect(connections.releaseParticipant(7, first)).toBe(false);
    expect(state.readinessOf(7)?.connected).toBe(true);

    expect(connections.releaseParticipant(7, second)).toBe(true);
  });
});

describe("operator telemetry coalescing", () => {
  test("many changes in one interval produce one update, not one per event", () => {
    const telemetry = new OperatorTelemetry(500);
    for (let i = 0; i < 50; i++) telemetry.mark();

    expect(telemetry.due(1000)).toBe(true);
    for (let i = 0; i < 50; i++) telemetry.mark();
    expect(telemetry.due(1100)).toBe(false);
    expect(telemetry.due(1500)).toBe(true);
  });

  test("a quiet session sends nothing at all", () => {
    const telemetry = new OperatorTelemetry(500);
    expect(telemetry.due(1000)).toBe(false);
    expect(telemetry.due(5000)).toBe(false);
  });

  test("operators receive broadcasts and participants are not in that set", () => {
    const connections = new ConnectionRegistry();
    const operator = new FakeSocket();
    const participant = new FakeSocket();
    connections.addOperator(operator);
    connections.bindParticipant(0, participant);

    connections.broadcastToOperators("snapshot");

    expect(operator.sent).toEqual(["snapshot"]);
    expect(participant.sent).toEqual([]);
    expect(connections.operatorCount).toBe(1);
  });
});
