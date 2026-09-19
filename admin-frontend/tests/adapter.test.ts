import { expect, test } from "bun:test";
import { createAdapter, AdapterError } from "../src/lib/adapter";

// The fake-input harness has been removed; the console talks to the real server. These tests
// verify the graceful "not detected" path: when no server is listening, every adapter call throws
// a clean AdapterError(SERVER_UNREACHABLE) instead of a raw network error or fake success. A dead
// port (nothing listening) stands in for a missing real server.

const deadPort = 18099; // nothing listens here
const base = `http://127.0.0.1:${deadPort}`;

test("getSnapshot reports SERVER_UNREACHABLE when no server is detected", async () => {
  const adapter = createAdapter(base);
  await expect(adapter.getSnapshot()).rejects.toMatchObject({ code: "SERVER_UNREACHABLE" });
  try {
    await adapter.getSnapshot();
    expect.unreachable("should have thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).message).toContain("not detected");
    expect((error as AdapterError).retryable).toBe(false);
  }
});

test("sendAssignment against a missing server marks the command as error, never fake success", async () => {
  const adapter = createAdapter(base);
  await expect(
    adapter.sendAssignment({ deviceIds: [0, 1], channelId: "ch-0", mapRevision: 1, effectiveServerMs: 0 }),
  ).rejects.toMatchObject({ code: "SERVER_UNREACHABLE" });
});

test("panic against a missing server surfaces SERVER_UNREACHABLE, not a silent success", async () => {
  const adapter = createAdapter(base);
  await expect(adapter.panic()).rejects.toMatchObject({ code: "SERVER_UNREACHABLE" });
});

test("createCalibration against a missing server surfaces SERVER_UNREACHABLE", async () => {
  const adapter = createAdapter(base);
  await expect(
    adapter.createCalibration([0, 1, 2], { zero: "#0000ff", one: "#ff0000", neutral: "#000000" }, "palette-v1"),
  ).rejects.toMatchObject({ code: "SERVER_UNREACHABLE" });
});
