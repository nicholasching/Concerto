import { afterAll, beforeAll, expect, test } from "bun:test";
import { createAdapter } from "../src/lib/adapter";
import { startAdminHarness } from "../../tools/admin-demo/server";

let harness: ReturnType<typeof startAdminHarness>;
const base = `http://127.0.0.1:18095`;

beforeAll(() => { harness = startAdminHarness(18095, 1500); });
afterAll(() => harness.stop());

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 4000, stepMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await predicate()) return true; await new Promise(r => setTimeout(r, stepMs)); }
  return false;
}

// Full operator walkthrough against the fake-input harness: uploads -> map -> selection ->
// assignment -> transport -> panic. This is the "done means" path from the subplot, driven as
// an automated test.
test("operator walkthrough: calibration to colored map to assignment to playhead to panic", async () => {
  const adapter = createAdapter(base);

  // 1. Session snapshot with 1,500 synthetic phones.
  let snap = await adapter.getSnapshot();
  expect(snap.devices.length).toBe(1500);
  const startMapRevision = snap.audienceMap.mapRevision;

  // 2. Calibration: create run, three fake uploads, process, commit.
  const calibration = await adapter.createCalibration([0, 1, 2, 3, 4], { zero: "#0000ff", one: "#ff0000", neutral: "#000000" }, "palette-v1");
  expect(calibration.runId).toBeTruthy();
  const up1 = await adapter.uploadCamera(calibration.runId, "cam-left", "left", null);
  const up2 = await adapter.uploadCamera(calibration.runId, "cam-center", "center", null);
  const up3 = await adapter.uploadCamera(calibration.runId, "cam-right", "right", null);
  expect([up1.uploadId, up2.uploadId, up3.uploadId].every(Boolean)).toBe(true);

  // One failed upload does not discard the others: simulate a 4th failing by hitting an unknown run.
  await expect(adapter.uploadCamera("run-does-not-exist", "cam-x", "left", null)).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });

  const job = await adapter.createJob(calibration.runId, [up1.uploadId, up2.uploadId, up3.uploadId]);
  expect(job.jobId).toBeTruthy();
  const completed = await waitFor(async () => (await adapter.getJobProgress(job.jobId)).stage === "complete", 5000);
  expect(completed).toBe(true);

  const committed = await adapter.commitMap(calibration.runId, job.jobId, startMapRevision);
  expect(committed.mapRevision).toBe(startMapRevision + 1);
  snap = await adapter.getSnapshot();
  expect(snap.audienceMap.mapRevision).toBe(startMapRevision + 1);

  // 3. Selection: pure geometry picks explicit IDs off the committed map (no UI here; the UI uses
  //    the same selectRectangle). Assign the first few localized IDs to channel 0.
  const localizedIds = snap.audienceMap.locations.filter(l => l.status === "localized").slice(0, 5).map(l => l.deviceId);
  expect(localizedIds.length).toBe(5);
  const assignResult = await adapter.sendAssignment({ deviceIds: localizedIds, channelId: snap.show.channels[0].channelId, mapRevision: snap.audienceMap.mapRevision, effectiveServerMs: 0 });
  expect(assignResult.commandId).toBeTruthy();

  // 4. The assignment is confirmed once the server applies it (effectiveServerMs=0).
  await waitFor(async () => {
    const s = await adapter.getSnapshot();
    return s.assignments.find(a => a.deviceId === localizedIds[0])?.channelId === snap.show.channels[0].channelId;
  });
  const confirmed = await adapter.getSnapshot();
  expect(confirmed.assignments.find(a => a.deviceId === localizedIds[0])?.channelId).toBe(snap.show.channels[0].channelId);

  // 5. Transport: play -> playhead moves -> stop. Pending then confirmed.
  await adapter.sendTransport({ action: "play", showRevision: confirmed.show.showRevision, positionMs: 0, effectiveServerMs: 0 });
  await waitFor(async () => (await adapter.getSnapshot()).transport.status === "playing");
  let playing = await adapter.getSnapshot();
  expect(playing.transport.status).toBe("playing");

  await adapter.sendTransport({ action: "stop", showRevision: confirmed.show.showRevision, positionMs: 0, effectiveServerMs: 0 });
  await waitFor(async () => (await adapter.getSnapshot()).transport.status === "stopped");
  const stopped = await adapter.getSnapshot();
  expect(stopped.transport.status).toBe("stopped");

  // 6. Panic clears pending and mutes.
  await adapter.sendAssignment({ deviceIds: localizedIds, channelId: null, mapRevision: stopped.audienceMap.mapRevision, effectiveServerMs: 1e12 });
  await adapter.panic();
  const afterPanic = await adapter.getSnapshot();
  expect(afterPanic.pendingActions.length).toBe(0);
  expect(afterPanic.transport.status).toBe("stopped");
  expect(afterPanic.show.channels.every(c => c.mute)).toBe(true);
});

test("stale selection is rejected, not shown as success", async () => {
  const adapter = createAdapter(base);
  await adapter.getSnapshot();
  await expect(
    adapter.sendAssignment({ deviceIds: [0], channelId: "ch-0", mapRevision: 999999, effectiveServerMs: 0 }),
  ).rejects.toMatchObject({ code: "STALE_MAP" });
});
