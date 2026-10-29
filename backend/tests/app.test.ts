import { expect, test } from "bun:test";
import { ApiError } from "@orchestra/contracts";
import { createApp } from "../src/app";
import { AssetStore } from "../src/assets";
import { CalibrationRuns } from "../src/calibration";
import { JobRunner } from "../src/jobs";
import { AudioLease } from "../src/lease";
import { CheckpointStore } from "../src/checkpoint";
import { DeviceRegistry } from "../src/registry";
import { RateLimiter } from "../src/rate-limit";
import { CommandLog } from "../src/commands";
import { ConnectionRegistry } from "../src/connections";
import { Preparations } from "../src/preparations";
import { SessionState } from "../src/state";

const app = () =>
  createApp({
    clock: { sessionId: "dev-session", serverEpoch: "epoch-a", nowServerMs: () => 1_000_000 },
    registry: new DeviceRegistry(),
    store: new CheckpointStore("/dev/null/unused"),
    joins: new RateLimiter(10, 10, () => 1_000_000),
    state: new SessionState(),
    commands: new CommandLog(),
    connections: new ConnectionRegistry(),
    preparations: new Preparations(),
    assets: new AssetStore("/tmp/orchestra-unused-assets"),
    uploads: new AssetStore("/tmp/orchestra-unused-uploads"),
    calibrations: new CalibrationRuns(),
    jobs: new JobRunner(),
    lease: new AudioLease(),
    jobWorkspace: "/tmp/orchestra-unused-jobs",
  });

test("health identifies the sync-control implementation", async () => {
  const response = await app().request("/api/health");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.implementation).toBe("sync-control");
  expect(body.deploymentCommit).toBe(process.env.RAILWAY_GIT_COMMIT_SHA ?? null);
  expect(body.deploymentId).toBe(process.env.RAILWAY_DEPLOYMENT_ID ?? null);
  expect(Object.keys(body).sort()).toEqual(["deploymentCommit", "deploymentId", "implementation", "protocolVersion", "service"]);
});
// Every route the masterplan named is implemented now, so this covers the catch-all itself: an
// unknown API path must fail as a structured protocol error, not as an HTML 404.
test("an unknown API route fails explicitly", async () => {
  const response = await app().request("/api/not-a-real-endpoint", { method: "POST", body: "{}" });
  expect(response.status).toBe(501);
  expect(ApiError.parse(await response.json()).error.code).toBe("NOT_IMPLEMENTED");
});
test("backend has no mock replay endpoint", async () => {
  expect((await app().request("/__mock__/state")).status).toBe(404);
});
