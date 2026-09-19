import { expect, test } from "bun:test";
import { ApiError } from "@orchestra/contracts";
import { createApp } from "../src/app";
import { CheckpointStore } from "../src/checkpoint";
import { DeviceRegistry } from "../src/registry";
import { RateLimiter } from "../src/rate-limit";

const app = () =>
  createApp({
    clock: { sessionId: "dev-session", serverEpoch: "epoch-a", nowServerMs: () => 1_000_000 },
    registry: new DeviceRegistry(),
    store: new CheckpointStore("/dev/null/unused"),
    joins: new RateLimiter(10, 10, () => 1_000_000),
  });

test("health identifies a foundation, not a running concert", async () => {
  const response = await app().request("/api/health");
  expect(response.status).toBe(200);
  expect((await response.json()).implementation).toBe("foundation");
});
test("unfinished mutation routes fail explicitly", async () => {
  const response = await app().request("/api/assignments", { method: "POST", body: "{}" });
  expect(response.status).toBe(501);
  expect(ApiError.parse(await response.json()).error.code).toBe("NOT_IMPLEMENTED");
});
test("backend has no mock replay endpoint", async () => {
  expect((await app().request("/__mock__/state")).status).toBe(404);
});
