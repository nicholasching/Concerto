import { afterAll, beforeAll, expect, test } from "bun:test";
import { createAdapter, AdapterError } from "../src/lib/adapter";
import { startAdminHarness } from "../../tools/admin-demo/server";

let harness: ReturnType<typeof startAdminHarness>;
const base = `http://127.0.0.1:18094`;

beforeAll(() => { harness = startAdminHarness(18094, 60); });
afterAll(() => harness.stop());

test("getSnapshot returns a parsed admin snapshot with synthetic evidence", async () => {
  const adapter = createAdapter(base);
  const snapshot = await adapter.getSnapshot();
  expect(snapshot.role).toBe("admin");
  expect(snapshot.audienceMap.evidence).toBe("synthetic");
  expect(snapshot.devices.length).toBe(60);
});

test("sendAssignment keeps the command pending until the server confirms it", async () => {
  const adapter = createAdapter(base);
  await adapter.getSnapshot();
  const mapRevision = (await adapter.getSnapshot()).audienceMap.mapRevision;
  // Schedule far in the future so it stays pending.
  const result = await adapter.sendAssignment({ deviceIds: [0, 1, 2], channelId: "ch-0", mapRevision, effectiveServerMs: 1e12 });
  expect(result.commandId).toBeTruthy();
  const pendingNow = adapter.pending().filter(p => p.commandId === result.commandId);
  expect(pendingNow[0].status).toBe("pending");
});

test("sendAssignment confirms once the effective time has passed", async () => {
  const adapter = createAdapter(base);
  await adapter.getSnapshot();
  const mapRevision = (await adapter.getSnapshot()).audienceMap.mapRevision;
  const result = await adapter.sendAssignment({ deviceIds: [3], channelId: "ch-1", mapRevision, effectiveServerMs: 0 });
  // Fetch again; effectiveServerMs=0 means the harness applies it, advancing revision -> confirmed.
  await adapter.getSnapshot();
  await adapter.getSnapshot();
  const cmd = adapter.pendingById(result.commandId);
  expect(cmd?.status).toBe("confirmed");
});

test("a stale mapRevision is rejected with STALE_MAP and surfaces as AdapterError, not fake success", async () => {
  const adapter = createAdapter(base);
  await adapter.getSnapshot();
  await expect(
    adapter.sendAssignment({ deviceIds: [0], channelId: "ch-0", mapRevision: 999999, effectiveServerMs: 0 }),
  ).rejects.toMatchObject({ code: "STALE_MAP" });
  try {
    await adapter.sendAssignment({ deviceIds: [0], channelId: "ch-0", mapRevision: 999999, effectiveServerMs: 0 });
    expect.unreachable("should have thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).retryable).toBe(false);
  }
});

test("panic clears pending actions and stops transport on the server", async () => {
  const adapter = createAdapter(base);
  const before = await adapter.getSnapshot();
  const mapRevision = before.audienceMap.mapRevision;
  await adapter.sendAssignment({ deviceIds: [0], channelId: "ch-0", mapRevision, effectiveServerMs: 1e12 });
  await adapter.panic();
  const after = await adapter.getSnapshot();
  expect(after.pendingActions.length).toBe(0);
  expect(after.transport.status).toBe("stopped");
});
