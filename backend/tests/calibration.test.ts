import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import {
  ApiError, CalibrationPlan, CalibrationRun, ClientMessage, PROTOCOL_VERSION, ServerMessage,
} from "@orchestra/contracts";
import { createApp, DEFAULT_LEAD_TIME_MS } from "../src/app";
import { AssetStore } from "../src/assets";
import { CalibrationRuns, MAX_CAMERAS } from "../src/calibration";
import { JobRunner } from "../src/jobs";
import { AudioLease } from "../src/lease";
import { CheckpointStore } from "../src/checkpoint";
import type { ServerClock } from "../src/clock";
import { CommandLog } from "../src/commands";
import { ConnectionRegistry, type ClientSocket } from "../src/connections";
import { handleClientMessage } from "../src/messages";
import { Preparations } from "../src/preparations";
import { DeviceRegistry } from "../src/registry";
import { RateLimiter } from "../src/rate-limit";
import { SessionState } from "../src/state";

const SESSION = "session-under-test";
const SECRET = "operator-secret-for-tests";
const EPOCH = "epoch-a";
const PALETTE = { zero: "#1020ff", one: "#ff2010", neutral: "#101010" };

let directory: string;
let serverMs: number;

beforeEach(async () => {
  directory = await mkdtemp(joinPath(tmpdir(), "orchestra-calibration-"));
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

const harness = () => {
  const clock: ServerClock = { sessionId: SESSION, serverEpoch: EPOCH, nowServerMs: () => serverMs };
  const state = new SessionState();
  const preparations = new Preparations();
  const connections = new ConnectionRegistry();
  const calibrations = new CalibrationRuns();
  const uploadDirectory = joinPath(directory, "uploads");
  const app = createApp({
    clock, state, preparations, connections, calibrations, operatorSecret: SECRET,
    registry: new DeviceRegistry(),
    store: new CheckpointStore(joinPath(directory, "checkpoint.json")),
    joins: new RateLimiter(100, 100, () => serverMs),
    commands: new CommandLog(),
    assets: new AssetStore(joinPath(directory, "assets")),
    uploads: new AssetStore(uploadDirectory),
    jobs: new JobRunner(),
    lease: new AudioLease(),
    jobWorkspace: joinPath(directory, "jobs"),
  });
  const sockets = new Map<number, FakeSocket>();
  for (const deviceId of [0, 1, 2]) {
    state.register(deviceId);
    state.setConnected(deviceId, true);
    const socket = new FakeSocket();
    sockets.set(deviceId, socket);
    connections.bindParticipant(deviceId, socket);
  }
  return { app, state, preparations, connections, calibrations, clock, sockets, uploadDirectory };
};

type Harness = ReturnType<typeof harness>;

const createRun = (context: Harness, options: { commandId?: string; participantIds?: number[]; secret?: string } = {}) =>
  context.app.request("/api/calibrations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-operator-secret": options.secret ?? SECRET },
    body: JSON.stringify({
      protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: EPOCH,
      commandId: options.commandId ?? "run-1", expectedRevision: 0,
      participantIds: options.participantIds ?? [0, 1, 2], palette: PALETTE, paletteVersion: "palette-v1",
    }),
  });

const acknowledge = (context: Harness, deviceId: number, options: {
  preparationId: string; runId: string; ready?: boolean;
}) =>
  handleClientMessage({
    raw: JSON.stringify(ClientMessage.parse({
      protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: EPOCH, messageId: `ack-${deviceId}`,
      type: "calibration.ready",
      payload: {
        preparationId: options.preparationId, runId: options.runId,
        ready: options.ready ?? true, reason: null,
      },
    })),
    receivedServerMs: serverMs, clock: context.clock, deviceId,
    state: context.state, preparations: context.preparations, calibrations: context.calibrations,
  });

const arm = (context: Harness, options: {
  runId: string; preparationId: string; commandId?: string; effectiveServerMs?: number;
}) =>
  context.app.request(`/api/calibrations/${options.runId}/arm`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-operator-secret": SECRET },
    body: JSON.stringify({
      protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: EPOCH,
      commandId: options.commandId ?? "arm-1", expectedRevision: 0,
      runId: options.runId, preparationId: options.preparationId,
      effectiveServerMs: options.effectiveServerMs ?? serverMs + DEFAULT_LEAD_TIME_MS,
    }),
  });

const clip = (size = 2048) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 7) % 256;
  return bytes;
};

const uploadClip = (context: Harness, options: {
  runId: string; cameraId?: string; commandId?: string; label?: string; bytes?: Uint8Array;
  declaredSize?: number; primaryColumn?: string;
}) => {
  const bytes = options.bytes ?? clip();
  const query = new URLSearchParams({
    commandId: options.commandId ?? "upload-1",
    cameraId: options.cameraId ?? "camera-left",
    primaryColumn: options.primaryColumn ?? "left",
    rotationDegrees: "0",
    byteSize: String(options.declaredSize ?? bytes.byteLength),
    label: options.label ?? "GX010023.MP4",
  });
  return context.app.request(`/api/calibrations/${options.runId}/uploads?${query}`, {
    method: "POST",
    headers: { "x-operator-secret": SECRET, "content-type": "application/octet-stream" },
    body: bytes.buffer as ArrayBuffer,
  });
};

const planOf = async (response: Response) => CalibrationPlan.parse((await response.json()).plan);

describe("creating a calibration run", () => {
  test("freezes the participants and the frozen packet versions", async () => {
    const context = harness();
    const body = await (await createRun(context)).json();
    const plan = CalibrationPlan.parse(body.plan);

    expect(plan.participantIds).toEqual([0, 1, 2]);
    expect(plan.runTag).toBe(0);
    expect(plan).toMatchObject({ packetVersion: "otc-v2", codebookVersion: "hamming16-11-v1", symbolMs: 250 });
    expect(body.preparationId).toBe(context.preparations.current("calibration")?.preparationId);
  });

  test("tells only the frozen participants to prepare", async () => {
    const context = harness();
    await createRun(context, { participantIds: [0, 1] });

    expect(context.sockets.get(0)?.typed("calibration.prepare")).toHaveLength(1);
    expect(context.sockets.get(2)?.typed("calibration.prepare")).toHaveLength(0);
  });

  test("drops named devices that are not connected rather than counting phantom exclusions", async () => {
    const context = harness();
    context.state.setConnected(2, false);

    const plan = await planOf(await createRun(context, { participantIds: [0, 1, 2] }));
    expect(plan.participantIds).toEqual([0, 1]);
  });

  test("refuses a run when none of the named devices are connected", async () => {
    const context = harness();
    for (const deviceId of [0, 1, 2]) context.state.setConnected(deviceId, false);

    const response = await createRun(context);
    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("NO_ELIGIBLE_PARTICIPANTS");
  });

  test("permits only one active run", async () => {
    const context = harness();
    await createRun(context, { commandId: "run-1" });

    const response = await createRun(context, { commandId: "run-2" });
    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("RUN_IN_PROGRESS");
  });

  test("never reuses a run tag within a session", async () => {
    const context = harness();
    const first = await planOf(await createRun(context, { commandId: "run-1" }));
    context.calibrations.setStatus(first.runId, "committed");
    const second = await planOf(await createRun(context, { commandId: "run-2" }));

    expect(second.runTag).toBe(first.runTag + 1);
    expect(second.runId).not.toBe(first.runId);
  });

  test("requires the operator secret", async () => {
    const context = harness();
    expect((await createRun(context, { secret: "wrong" })).status).toBe(401);
  });
});

describe("arming a run", () => {
  test("starts only the phones that acknowledged, and reports who was left out", async () => {
    const context = harness();
    const plan = await planOf(await createRun(context));
    const preparationId = context.preparations.current("calibration")!.preparationId;
    acknowledge(context, 0, { preparationId, runId: plan.runId });
    acknowledge(context, 1, { preparationId, runId: plan.runId, ready: false });

    const startAt = serverMs + 5000;
    const response = await arm(context, { runId: plan.runId, preparationId, effectiveServerMs: startAt });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ready).toBe(1);
    expect(body.excluded).toEqual([{ deviceId: 1, reason: "reported not ready" }]);

    const armed = context.sockets.get(0)?.typed("calibration.arm") ?? [];
    expect(armed).toHaveLength(1);
    if (armed[0].type !== "calibration.arm") throw new Error("expected calibration.arm");
    expect(CalibrationRun.parse(armed[0].payload.run).startServerMs).toBe(startAt);
    expect(context.sockets.get(1)?.typed("calibration.arm")).toHaveLength(0);
  });

  test("refuses an acknowledgement that names a different run", async () => {
    const context = harness();
    const plan = await planOf(await createRun(context));
    const preparationId = context.preparations.current("calibration")!.preparationId;

    const reply = acknowledge(context, 0, { preparationId, runId: "some-other-run" });

    if (reply.type !== "error") throw new Error("expected an error");
    expect(reply.payload.error.code).toBe("STALE_PREPARATION");
    expect(context.preparations.current("calibration")?.counts().ready).toBe(0);
    expect(plan.runId).not.toBe("some-other-run");
  });

  test("refuses arming against a preparation that is no longer current", async () => {
    const context = harness();
    const plan = await planOf(await createRun(context));
    const preparationId = context.preparations.current("calibration")!.preparationId;
    acknowledge(context, 0, { preparationId, runId: plan.runId });

    const response = await arm(context, { runId: plan.runId, preparationId: "stale-preparation" });
    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("STALE_PREPARATION");
  });

  test("refuses arming when nobody acknowledged", async () => {
    const context = harness();
    const plan = await planOf(await createRun(context));
    const preparationId = context.preparations.current("calibration")!.preparationId;

    const response = await arm(context, { runId: plan.runId, preparationId });
    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("NOBODY_READY");
  });

  test("refuses a start that leaves no time to schedule it", async () => {
    const context = harness();
    const plan = await planOf(await createRun(context));
    const preparationId = context.preparations.current("calibration")!.preparationId;
    acknowledge(context, 0, { preparationId, runId: plan.runId });

    const response = await arm(context, {
      runId: plan.runId, preparationId, effectiveServerMs: serverMs + DEFAULT_LEAD_TIME_MS - 1,
    });
    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("INSUFFICIENT_LEAD_TIME");
  });

  test("refuses an unknown run", async () => {
    const context = harness();
    await createRun(context);
    const preparationId = context.preparations.current("calibration")!.preparationId;

    const response = await arm(context, { runId: "0191d4aa-0000-7000-8000-000000000000", preparationId });
    expect(response.status).toBe(404);
  });
});

describe("camera uploads", () => {
  test("records the hash of the bytes that arrived", async () => {
    const context = harness();
    const plan = await planOf(await createRun(context));
    const bytes = clip();

    const upload = await (await uploadClip(context, { runId: plan.runId, bytes })).json();

    expect(upload.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(upload.byteSize).toBe(bytes.byteLength);
    expect(upload.cameraId).toBe("camera-left");
    expect(upload.runId).toBe(plan.runId);
  });

  test("a hostile filename never becomes a path", async () => {
    const context = harness();
    const plan = await planOf(await createRun(context));

    const upload = await (await uploadClip(context, {
      runId: plan.runId, label: "../../etc/passwd; rm -rf /",
    })).json();

    expect(upload.label).toBe("../../etc/passwd; rm -rf /");
    // The file on disk is named by the server-generated id, and nothing escaped the directory.
    const stored = await readdir(context.uploadDirectory);
    expect(stored).toEqual([upload.uploadId]);
  });

  test("refuses a second recording for the same camera", async () => {
    const context = harness();
    const plan = await planOf(await createRun(context));
    await uploadClip(context, { runId: plan.runId, commandId: "upload-1", cameraId: "camera-left" });

    const response = await uploadClip(context, { runId: plan.runId, commandId: "upload-2", cameraId: "camera-left" });
    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("CAMERA_ALREADY_UPLOADED");
  });

  test("refuses more cameras than a run accepts", async () => {
    const context = harness();
    const plan = await planOf(await createRun(context));
    for (let i = 0; i < MAX_CAMERAS; i++) {
      await uploadClip(context, { runId: plan.runId, commandId: `upload-${i}`, cameraId: `camera-${i}` });
    }

    const response = await uploadClip(context, { runId: plan.runId, commandId: "upload-extra", cameraId: "camera-extra" });
    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("TOO_MANY_CAMERAS");
  });

  test("refuses a recording that ended early and leaves nothing behind", async () => {
    const context = harness();
    const plan = await planOf(await createRun(context));

    const response = await uploadClip(context, { runId: plan.runId, declaredSize: 999_999 });

    expect(response.status).toBe(400);
    expect(ApiError.parse(await response.json()).error.code).toBe("TRUNCATED_UPLOAD");
    expect(await readdir(context.uploadDirectory).catch(() => [])).toEqual([]);
  });

  test("refuses an upload for a run that does not exist", async () => {
    const context = harness();
    const response = await uploadClip(context, { runId: "0191d4aa-0000-7000-8000-000000000000" });
    expect(response.status).toBe(404);
  });

  test("a retried upload returns the original receipt", async () => {
    const context = harness();
    const plan = await planOf(await createRun(context));

    const first = await (await uploadClip(context, { runId: plan.runId, commandId: "upload-1" })).json();
    const retry = await (await uploadClip(context, { runId: plan.runId, commandId: "upload-1" })).json();

    expect(retry).toEqual(first);
    expect(await readdir(context.uploadDirectory)).toHaveLength(1);
  });
});
