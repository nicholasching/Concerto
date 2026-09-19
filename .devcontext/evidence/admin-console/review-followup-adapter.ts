// Review-only deterministic checks for 909e42a; no network service or product edits.
import assert from "node:assert/strict";
import { createAdapter } from "../../../admin-frontend/src/lib/adapter";
import { AdminSnapshot, CommandAccepted } from "../../../packages/contracts/src/index";
import { showPositionMs, syncFromServerMs } from "../../../admin-frontend/src/lib/clock";
import fixture from "../../../fixtures/admin-snapshot.json";

const snapshot = (revision: number, epoch = fixture.serverEpoch) => AdminSnapshot.parse({ ...structuredClone(fixture), revision, serverEpoch: epoch });
const accepted = (body: any) => CommandAccepted.parse({ protocolVersion: 1, sessionId: body.sessionId, serverEpoch: body.serverEpoch, commandId: body.commandId, revision: body.expectedRevision + 1 });
const logs: unknown[] = [];

let state = snapshot(10);
const failed = createAdapter("http://review.invalid", async (_url, init) => {
  if (init?.method === "POST") throw new TypeError("not dispatched");
  return Response.json(state);
});
await failed.getSnapshot();
await assert.rejects(failed.sendAssignment({ deviceIds: [0], channelId: null, mapRevision: state.audienceMap.mapRevision, effectiveServerMs: state.serverMs + 3000 }));
state = snapshot(11);
await failed.getSnapshot();
assert.equal(failed.pending()[0].status, "error");
logs.push({ issue: "R2", result: "fixed subcase", evidence: "Undelivered command remains error after unrelated revision." });

for (const cancellation of ["superseded", "panic"] as const) {
  state = snapshot(20);
  let body: any;
  const adapter = createAdapter("http://review.invalid", async (_url, init) => {
    if (init?.method === "POST") { body = JSON.parse(String(init.body)); return Response.json(accepted(body)); }
    return Response.json(state);
  });
  await adapter.getSnapshot();
  const response = await adapter.sendAssignment({ deviceIds: [0], channelId: null, mapRevision: state.audienceMap.mapRevision, effectiveServerMs: state.serverMs + 60000 });
  const action = { commandId: response.commandId, domain: "assignment", effectiveServerMs: body.effectiveServerMs, supersedesCommandId: null, assignments: [{ ...state.assignments[0], channelId: null }] };
  state = AdminSnapshot.parse({ ...state, revision: 21, pendingActions: [action] });
  await adapter.getSnapshot();
  assert.equal(adapter.pending()[0].status, "scheduled");
  state = AdminSnapshot.parse({ ...state, revision: 22, pendingActions: cancellation === "panic" ? [] : [{ ...action, commandId: "replacement", supersedesCommandId: response.commandId }] });
  await adapter.getSnapshot();
  assert.equal(adapter.pending()[0].status, "effective");
  logs.push({ issue: "R2", result: "still broken", cancellation, status: adapter.pending()[0].status, remainingUntilOriginalDeadlineMs: action.effectiveServerMs - state.serverMs, evidence: "Assignment never applied; cancellation is misclassified as effectiveness." });
}

// A delayed older snapshot no longer replaces the newer request's epoch.
const resolvers: ((r: Response) => void)[] = [];
let panicBody: any;
const ordered = createAdapter("http://review.invalid", (_url, init) => {
  if (init?.method === "POST") { panicBody = JSON.parse(String(init.body)); return Promise.resolve(Response.json(accepted(panicBody))); }
  return new Promise(resolve => resolvers.push(resolve));
});
const oldGet = ordered.getSnapshot(), newGet = ordered.getSnapshot();
resolvers[1](Response.json(snapshot(1, "new-epoch"))); await newGet;
resolvers[0](Response.json(snapshot(30, "old-epoch"))); await oldGet;
await ordered.panic();
assert.equal(panicBody.serverEpoch, "new-epoch");
logs.push({ issue: "R10", result: "fixed subcase", evidence: "Older in-flight GET cannot roll back a newer accepted GET." });

// A pending POST also crosses epochs and is not covered by the GET sequencing fix.
state = snapshot(40, "old-epoch");
let postResolve!: (r: Response) => void;
let postBody: any;
const delayedPost = createAdapter("http://review.invalid", (_url, init) => {
  if (init?.method === "POST") { postBody = JSON.parse(String(init.body)); return new Promise(resolve => { postResolve = resolve; }); }
  return Promise.resolve(Response.json(state));
});
await delayedPost.getSnapshot();
const oldPost = delayedPost.sendAssignment({ deviceIds: [0], channelId: null, mapRevision: state.audienceMap.mapRevision, effectiveServerMs: state.serverMs + 3000 });
state = snapshot(1, "new-epoch");
await delayedPost.getSnapshot();
assert.equal(delayedPost.pending()[0].status, "obsolete");
postResolve(Response.json(accepted(postBody))); await oldPost;
assert.equal(delayedPost.pending()[0].status, "accepted");
logs.push({ issue: "R10", result: "still broken", evidence: "Late old-epoch POST reply changes obsolete command back to accepted." });

const contractAdapter = createAdapter("http://review.invalid", async (_url, init) => init?.method === "POST" ? Response.json(accepted(JSON.parse(String(init.body)))) : Response.json(snapshot(50)));
await contractAdapter.getSnapshot();
const run = await contractAdapter.createCalibration([0], { zero: "#0000ff", one: "#ff0000", neutral: "#000000" }, "palette-v1");
const job = await contractAdapter.createJob("run", ["upload"]);
assert.equal(run.runId, undefined); assert.equal(job.jobId, undefined);
logs.push({ issue: "R8", result: "unchanged", evidence: "Valid frozen CommandAccepted still yields undefined runId and jobId." });

const originalPerformance = globalThis.performance;
try {
  let localMs = 1200;
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { timeOrigin: 0, now: () => localMs } });
  syncFromServerMs(1000); localMs = 2600;
  const transport = { status: "playing" as const, positionMs: 0, startServerMs: 0 };
  const before = showPositionMs(transport); syncFromServerMs(2000); const after = showPositionMs(transport);
  assert.equal(before - after, 400);
  logs.push({ issue: "R11", result: "unchanged", backwardJumpMs: before - after });
} finally { Object.defineProperty(globalThis, "performance", { configurable: true, value: originalPerformance }); }
console.log(JSON.stringify({ reviewedHead: "909e42a", category: "deterministic boundary checks; observed defect assertions are not acceptance", checks: logs }, null, 2));
