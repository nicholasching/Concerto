import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { ApiError, JoinResponse } from "@orchestra/contracts";
import { createApp } from "../src/app";
import { AssetStore } from "../src/assets";
import { CalibrationRuns } from "../src/calibration";
import { JobRunner } from "../src/jobs";
import { CheckpointStore } from "../src/checkpoint";
import type { ServerClock } from "../src/clock";
import { DeviceRegistry, MAX_DEVICES } from "../src/registry";
import { RateLimiter } from "../src/rate-limit";
import { CommandLog } from "../src/commands";
import { ConnectionRegistry } from "../src/connections";
import { Preparations } from "../src/preparations";
import { SessionState } from "../src/state";

const SESSION = "session-under-test";

let directory: string;
let serverMs: number;

beforeEach(async () => {
  directory = await mkdtemp(joinPath(tmpdir(), "orchestra-checkpoint-"));
  serverMs = 1_000_000;
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const clock = (): ServerClock => ({ sessionId: SESSION, serverEpoch: "epoch-a", nowServerMs: () => serverMs });

const harness = (options: { capacity?: number; refillPerSecond?: number } = {}) => {
  const store = new CheckpointStore(joinPath(directory, "checkpoint.json"));
  const registry = new DeviceRegistry();
  const serverClock = clock();
  const app = createApp({
    clock: serverClock,
    registry,
    store,
    joins: new RateLimiter(options.capacity ?? 100, options.refillPerSecond ?? 100, () => serverMs),
    state: new SessionState(),
    commands: new CommandLog(),
    connections: new ConnectionRegistry(),
    preparations: new Preparations(),
    assets: new AssetStore(joinPath(directory, "assets")),
    uploads: new AssetStore(joinPath(directory, "uploads")),
    calibrations: new CalibrationRuns(),
    jobs: new JobRunner(),
    jobWorkspace: joinPath(directory, "jobs"),
  });
  return { app, registry, store, clock: serverClock };
};

const join = async (app: ReturnType<typeof createApp>, resumeToken?: string, sessionId = SESSION) =>
  app.request(`/api/sessions/${sessionId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(resumeToken === undefined ? {} : { resumeToken }),
  });

describe("join and resume", () => {
  test("the first device is ID 0 and zero is never treated as missing", async () => {
    const { app, registry } = harness();
    const body = JoinResponse.parse(await (await join(app)).json());

    expect(body.deviceId).toBe(0);
    expect(body.resumeToken.length).toBeGreaterThanOrEqual(16);
    expect(registry.has(0)).toBe(true);
    expect(registry.size).toBe(1);
  });

  test("allocates sequentially and never reissues an ID", async () => {
    const { app } = harness();
    const first = JoinResponse.parse(await (await join(app)).json());
    const second = JoinResponse.parse(await (await join(app)).json());
    const third = JoinResponse.parse(await (await join(app)).json());

    expect([first.deviceId, second.deviceId, third.deviceId]).toEqual([0, 1, 2]);
    expect(new Set([first.resumeToken, second.resumeToken, third.resumeToken]).size).toBe(3);
  });

  test("a valid resume token returns the same identity without allocating another", async () => {
    const { app, registry } = harness();
    const first = JoinResponse.parse(await (await join(app)).json());
    const resumed = JoinResponse.parse(await (await join(app, first.resumeToken)).json());

    expect(resumed.deviceId).toBe(first.deviceId);
    expect(registry.size).toBe(1);
  });

  test("a forged token is rejected and allocates nothing", async () => {
    const { app, registry } = harness();
    await join(app);
    const response = await join(app, "not-a-real-token-but-long-enough");

    expect(response.status).toBe(401);
    expect(ApiError.parse(await response.json()).error.code).toBe("INVALID_RESUME_TOKEN");
    expect(registry.size).toBe(1);
  });

  test("a second join without a token gets a different identity", async () => {
    const { app } = harness();
    const first = JoinResponse.parse(await (await join(app)).json());
    const second = JoinResponse.parse(await (await join(app)).json());
    expect(second.deviceId).not.toBe(first.deviceId);
  });

  test("rejects a join addressed to another session", async () => {
    const { app } = harness();
    const response = await join(app, undefined, "some-other-session");
    expect(response.status).toBe(404);
    expect(ApiError.parse(await response.json()).error.code).toBe("WRONG_SESSION");
  });

  test("rejects joins past capacity instead of wrapping the counter", () => {
    const registry = new DeviceRegistry();
    for (let i = 0; i < MAX_DEVICES; i++) {
      const outcome = registry.join(undefined, serverMs);
      if (!outcome.ok) throw new Error(`allocation ${i} failed`);
      expect(outcome.deviceId).toBe(i);
    }
    expect(registry.join(undefined, serverMs)).toEqual({ ok: false, code: "CAPACITY_REACHED" });
    expect(registry.size).toBe(MAX_DEVICES);
  });

  test("sheds joins once the global bucket is empty, and recovers as it refills", async () => {
    const { app } = harness({ capacity: 2, refillPerSecond: 1 });
    expect((await join(app)).status).toBe(200);
    expect((await join(app)).status).toBe(200);

    const shed = await join(app);
    expect(shed.status).toBe(429);
    expect(ApiError.parse(await shed.json()).error.retryable).toBe(true);

    serverMs += 1000;
    expect((await join(app)).status).toBe(200);
  });
});

describe("durable identity", () => {
  test("a restart restores identities and keeps allocating above them", async () => {
    const first = harness();
    const original = JoinResponse.parse(await (await join(first.app)).json());
    await join(first.app);

    const restarted = harness();
    const checkpoint = await restarted.store.read();
    if (!checkpoint) throw new Error("expected a checkpoint on disk");
    restarted.registry.restore(checkpoint);

    const resumed = JoinResponse.parse(await (await join(restarted.app, original.resumeToken)).json());
    expect(resumed.deviceId).toBe(original.deviceId);
    const fresh = JoinResponse.parse(await (await join(restarted.app)).json());
    expect(fresh.deviceId).toBe(2);
  });

  test("the stored token is a hash, not the credential itself", async () => {
    const { app, store } = harness();
    const body = JoinResponse.parse(await (await join(app)).json());
    const raw = await readFile(joinPath(directory, "checkpoint.json"), "utf8");

    expect(raw).not.toContain(body.resumeToken);
    const checkpoint = await store.read();
    expect(checkpoint?.devices[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("a truncated checkpoint is rejected rather than silently starting empty", async () => {
    const path = joinPath(directory, "checkpoint.json");
    await writeFile(path, '{"version":1,"sessionId":"session-under-test","devices":[', "utf8");
    expect(new CheckpointStore(path).read()).rejects.toThrow();
  });

  test("a missing checkpoint is a clean first start", async () => {
    expect(await new CheckpointStore(joinPath(directory, "absent.json")).read()).toBeNull();
  });

  test("concurrent saves leave a complete file, not an interleaved one", async () => {
    const { app, store, registry, clock: serverClock } = harness();
    await Promise.all([join(app), join(app), join(app)]);
    await store.save(registry.toCheckpoint(serverClock.sessionId));

    const checkpoint = await store.read();
    expect(checkpoint?.devices.map(device => device.deviceId)).toEqual([0, 1, 2]);
  });
});
