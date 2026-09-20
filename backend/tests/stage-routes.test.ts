import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppDeps } from "../src/app";
import { AssetStore } from "../src/assets";
import { CalibrationRuns } from "../src/calibration";
import { CheckpointStore } from "../src/checkpoint";
import { CommandLog } from "../src/commands";
import { ConnectionRegistry, RESET_CODE } from "../src/connections";
import { JobRunner } from "../src/jobs";
import { AudioLease } from "../src/lease";
import { Preparations } from "../src/preparations";
import { RateLimiter } from "../src/rate-limit";
import { DeviceRegistry } from "../src/registry";
import { SessionState, PLACEHOLDER_SHOW } from "../src/state";
import { CAMERA_CHUNK_BYTES } from "../src/stage-routes";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function harness() {
  const directory = await mkdtemp(join(tmpdir(), "orchestra-stage-")); directories.push(directory);
  const deps: AppDeps = {
    clock: { sessionId: "stage-test", serverEpoch: "epoch-original", nowServerMs: () => 100000 },
    registry: new DeviceRegistry(), state: new SessionState(), store: new CheckpointStore(join(directory, "checkpoint.json")),
    commands: new CommandLog(), connections: new ConnectionRegistry(), preparations: new Preparations(),
    assets: new AssetStore(join(directory, "assets")), uploads: new AssetStore(join(directory, "uploads")),
    calibrations: new CalibrationRuns(), jobs: new JobRunner(), lease: new AudioLease(),
    joins: new RateLimiter(100, 100, () => 100000), jobWorkspace: join(directory, "jobs"), operatorSecret: "test-stage-password",
  };
  const app = createApp(deps);
  const json = (path: string, body: object, headers: Record<string, string> = {}) => app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const addDevice = () => { const result = deps.registry.join(undefined, 100000); if (!result.ok) throw new Error(); deps.state.register(result.deviceId); deps.state.setConnected(result.deviceId, true); return result; };
  const addRun = () => { const result = deps.calibrations.create({ sessionId: deps.clock.sessionId, serverEpoch: deps.clock.serverEpoch, participantIds: [0], palette: { zero: "#FFB000", one: "#0066FF", neutral: "#111111" }, paletteVersion: "amber-blue-v1" }); if (!result.ok) throw new Error(); deps.calibrations.arm(result.run.plan.runId, 80000); return result.run; };
  const cameraLogin = async () => { const response = await json("/api/camera/login", { password: deps.operatorSecret }); expect(response.status).toBe(200); return (await response.json()).token as string; };
  return { app, deps, json, addDevice, addRun, cameraLogin };
}

test("projector exposes aggregate counts without operator, device or credential data", async () => {
  const { app, addDevice } = await harness(); addDevice();
  const response = await app.request("/api/presentation");
  const body = await response.json();
  expect(body).toMatchObject({ sessionId: "stage-test", connected: 1, synced: 0, assetsReady: 0 });
  expect(Object.keys(body).sort()).toEqual(["assetsReady", "connected", "mapped", "sessionId", "soundReady", "stage", "synced"]);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await app.request("/api/camera/session")).status).toBe(401);
});

test("projector stops asking the audience to raise phones after the pattern ends", async () => {
  const { app, deps, addDevice, addRun } = await harness(); addDevice(); addRun();
  deps.state.calibrationStage = "calibrating";
  expect((await (await app.request("/api/presentation")).json()).stage).toBe("processing");
});

test("reset revokes old phones, clears spatial/routing state, persists, preserves show and changes epoch", async () => {
  const { app, deps, json, addDevice, addRun, cameraLogin } = await harness();
  const device = addDevice(); const run = addRun();
  deps.state.saveShow({ ...PLACEHOLDER_SHOW, showId: "prepared-show", label: "Keep this music" });
  let closeCode: number | undefined;
  deps.connections.bindParticipant(device.deviceId, { send() {}, close(code) { closeCode = code; } });
  const token = await cameraLogin();
  const body = { commandId: "reset-one", sessionId: deps.clock.sessionId, serverEpoch: deps.clock.serverEpoch };
  expect((await json("/api/reset", body)).status).toBe(401);
  const response = await json("/api/reset", body, { "x-operator-secret": deps.operatorSecret! });
  expect(response.status).toBe(200); const ack = await response.json();
  expect(ack.serverEpoch).not.toBe(body.serverEpoch); expect(closeCode).toBe(RESET_CODE);
  expect(deps.registry.authenticate(device.resumeToken)).toBeNull(); expect(deps.registry.size).toBe(0);
  expect(deps.state.adminSnapshot(deps.clock).devices).toEqual([]); expect(deps.state.audienceMap.locations).toEqual([]);
  expect(deps.state.transport.status).toBe("stopped"); expect(deps.state.durableShow?.showId).toBe("prepared-show");
  expect(deps.calibrations.get(run.plan.runId)).toBeUndefined(); expect(deps.calibrations.nextTag).toBe(1);
  expect((await deps.store.read())?.devices).toEqual([]);
  expect((await app.request("/api/camera/session", { headers: { "x-upload-token": token } })).status).toBe(401);
  expect(await (await json("/api/reset", body, { "x-operator-secret": deps.operatorSecret! })).json()).toEqual(ack);
  expect((await json("/api/reset", { ...body, commandId: "stale-reset" }, { "x-operator-secret": deps.operatorSecret! })).status).toBe(409);
  expect(addDevice().deviceId).toBe(0);
});

test("camera access cannot control the show and completes exact video bytes through retried chunks", async () => {
  const { app, deps, json, addDevice, addRun, cameraLogin } = await harness(); addDevice(); const run = addRun();
  const token = await cameraLogin(); const headers = { "x-upload-token": token };
  expect((await json("/api/panic", {}, headers)).status).toBe(401);
  const bytes = new Uint8Array(CAMERA_CHUNK_BYTES + 9).fill(42);
  const started = await json("/api/camera/uploads", { runId: run.plan.runId, column: "left", label: "original.mp4", byteSize: bytes.length }, headers);
  expect(started.status).toBe(200); const { uploadId } = await started.json();
  expect((await json(`/api/camera/uploads/${uploadId}/complete`, {}, headers)).status).toBe(409);
  for (let index = 0; index < 2; index++) {
    const chunk = bytes.slice(index * CAMERA_CHUNK_BYTES, (index + 1) * CAMERA_CHUNK_BYTES);
    const hash = createHash("sha256").update(chunk).digest("hex");
    const send = () => app.request(`/api/camera/uploads/${uploadId}/${index}`, { method: "PUT", headers: { ...headers, "x-chunk-sha256": hash }, body: chunk });
    expect((await send()).status).toBe(200); expect((await send()).status).toBe(200);
    const status = await app.request(`/api/camera/uploads/${uploadId}`, { headers });
    expect((await status.json()).received).toEqual(Array.from({ length: index + 1 }, (_, i) => i));
  }
  const response = await json(`/api/camera/uploads/${uploadId}/complete`, {}, headers); expect(response.status).toBe(200);
  const receipt = await response.json();
  expect(receipt).toMatchObject({ cameraId: "camera-left", primaryColumn: "left", byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  expect(run.uploads.size).toBe(1);
  expect(await Bun.file(deps.uploads.path(uploadId)!).arrayBuffer()).toEqual(bytes.buffer);
  expect(await (await json(`/api/camera/uploads/${uploadId}/complete`, {}, headers)).json()).toEqual(receipt);
  expect((await (await app.request(`/api/camera/uploads/${uploadId}`, { headers })).json()).receipt).toEqual(receipt);
});

test("camera uploads reject corrupt bytes, other credentials, and recordings for a closed run", async () => {
  const { app, deps, json, addDevice, addRun, cameraLogin } = await harness(); addDevice(); const run = addRun();
  const token = await cameraLogin(); const headers = { "x-upload-token": token };
  const { uploadId } = await (await json("/api/camera/uploads", { runId: run.plan.runId, column: "right", label: "right.mp4", byteSize: 3 }, headers)).json();
  const other = await cameraLogin();
  expect((await app.request(`/api/camera/uploads/${uploadId}`, { headers: { "x-upload-token": other } })).status).toBe(404);
  expect((await json(`/api/camera/uploads/${uploadId}/complete`, {}, { "x-upload-token": other })).status).toBe(404);
  expect((await app.request(`/api/camera/uploads/${uploadId}/0`, { method: "PUT", headers: { ...headers, "x-chunk-sha256": "0".repeat(64) }, body: "abc" })).status).toBe(400);
  deps.calibrations.setStatus(run.plan.runId, "discarded");
  expect((await json(`/api/camera/uploads/${uploadId}/complete`, {}, headers)).status).toBe(409);
});
