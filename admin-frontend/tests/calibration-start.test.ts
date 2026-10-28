import { expect, test } from "bun:test";
import { calibrationStartDisabledReason } from "../src/lib/calibration-start";
import { createAdapter } from "../src/lib/adapter";
import snapshot from "../../fixtures/admin-snapshot.json";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminSnapshot, DEFAULT_CALIBRATION_PALETTE } from "@orchestra/contracts";
import { CalibrationPanel } from "../src/components/CalibrationPanel";

const barrier = { preparationId: "prep", domain: "calibration" as const, showRevision: 0, transportRevision: 0,
  expectedIds: [0, 1, 2], readyIds: [0], excluded: [] };

test("one ready phone enables calibration without any operator clock input", () => {
  expect(calibrationStartDisabledReason(false, barrier)).toBeNull();
});
test("each disabled condition explains the actual blocker", () => {
  expect(calibrationStartDisabledReason(true, barrier)).toContain("request to finish");
  expect(calibrationStartDisabledReason(false, undefined)).toContain("server to confirm");
  expect(calibrationStartDisabledReason(false, { ...barrier, readyIds: [], excluded: [{ deviceId: 1, reason: "clock" }] }))
    .toContain("2 pending, 1 excluded");
});
test("rendered start and capture progress work while the operator clock has no samples", () => {
  const plan = { protocolVersion: 1, sessionId: snapshot.sessionId, serverEpoch: snapshot.serverEpoch,
    runId: "run", runTag: 0, participantIds: [0], packetVersion: "otc-v2", codebookVersion: "hamming16-11-v1",
    symbolMs: 250, ...DEFAULT_CALIBRATION_PALETTE };
  const data = AdminSnapshot.parse({ ...snapshot, preparations: [barrier],
    calibration: { plan, preparationId: "prep", status: "created", startServerMs: null, uploads: [], reports: [] } });
  const render = () => renderToStaticMarkup(createElement(CalibrationPanel, { snapshot: data, refresh: () => {} }));
  expect(render()).toContain('aria-describedby="calibration-start-status"');
  expect(render()).not.toContain('disabled="" aria-describedby="calibration-start-status"');
  data.calibration!.status = "armed"; data.calibration!.startServerMs = data.serverMs - 12000;
  expect(render()).toContain("Pattern finished. Stop recordings");
});
test("calibration adapter sends intent without a timestamp or clock dependency", async () => {
  let request: Record<string, unknown> = {};
  const adapter = createAdapter("https://test", async (_url, init) => {
    if (!init?.body) return Response.json(snapshot);
    request = JSON.parse(String(init?.body));
    return Response.json({ protocolVersion: 1, sessionId: snapshot.sessionId, serverEpoch: snapshot.serverEpoch, commandId: request.commandId, revision: 0 });
  });
  adapter.configure("test", snapshot.sessionId);
  await adapter.getSnapshot();
  await expect(adapter.armCalibration("run", "prep")).resolves.toMatchObject({ revision: 0 });
  expect(request.runId).toBe("run");
  expect(request.preparationId).toBe("prep");
  expect("effectiveServerMs" in request).toBe(false);
});
