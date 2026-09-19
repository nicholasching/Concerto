import { expect, test } from "bun:test";
import { ApiError } from "@orchestra/contracts";
import { createApp } from "../src/app";

test("health identifies a foundation, not a running concert", async () => {
  const response = await createApp().request("/api/health");
  expect(response.status).toBe(200);
  expect((await response.json()).implementation).toBe("foundation");
});
test("unfinished mutation routes fail explicitly", async () => {
  const response = await createApp().request("/api/assignments", { method: "POST", body: "{}" });
  expect(response.status).toBe(501);
  expect(ApiError.parse(await response.json()).error.code).toBe("NOT_IMPLEMENTED");
});
test("backend has no mock replay endpoint", async () => {
  expect((await createApp().request("/__mock__/state")).status).toBe(404);
});
