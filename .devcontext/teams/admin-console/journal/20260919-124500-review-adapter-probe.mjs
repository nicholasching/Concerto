import assert from "node:assert/strict";
import { createAdapter } from "../../../../admin-frontend/src/lib/adapter.ts";
import { AdminSnapshot, CommandAccepted } from "../../../../packages/contracts/src/index.ts";
import { nowServerMs, showPositionMs, syncFromServerMs } from "../../../../admin-frontend/src/lib/clock.ts";
import fixture from "../../../../fixtures/admin-snapshot.json";

const originalFetch = globalThis.fetch;
const originalPerformance = globalThis.performance;
const snapshot = (revision, serverEpoch = fixture.serverEpoch) => AdminSnapshot.parse({ ...structuredClone(fixture), revision, serverEpoch });
const reply = data => Response.json(data);
const accepted = body => CommandAccepted.parse({ protocolVersion: 1, sessionId: body.sessionId, serverEpoch: body.serverEpoch, commandId: body.commandId, revision: body.expectedRevision + 1 });
const logs = [];
try {
  // 1. A request which never reaches the server is confirmed by an unrelated revision.
  let state = snapshot(10);
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") throw new TypeError("network unavailable before dispatch");
    return reply(state);
  };
  const failedAdapter = createAdapter("http://review.invalid");
  await failedAdapter.getSnapshot();
  await assert.rejects(() => failedAdapter.sendAssignment({ deviceIds: [0], channelId: null, mapRevision: state.audienceMap.mapRevision, effectiveServerMs: state.serverMs + 3000 }), { code: "SERVER_UNREACHABLE" });
  const failedState = failedAdapter.pending()[0].status;
  assert.equal(failedState, "pending");
  state = snapshot(11);
  await failedAdapter.getSnapshot();
  assert.equal(failedAdapter.pending()[0].status, "confirmed");
  logs.push({ case: "undelivered assignment", afterNetworkFailure: failedState, afterUnrelatedRevision: failedAdapter.pending()[0].status });

  // 2. A matching future pending action is labeled confirmed before it applies.
  state = snapshot(20);
  let sent;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") { sent = JSON.parse(init.body); return reply(accepted(sent)); }
    return reply(state);
  };
  const futureAdapter = createAdapter("http://review.invalid");
  await futureAdapter.getSnapshot();
  await futureAdapter.sendAssignment({ deviceIds: [0], channelId: null, mapRevision: state.audienceMap.mapRevision, effectiveServerMs: state.serverMs + 60000 });
  state = AdminSnapshot.parse({ ...state, revision: 21, pendingActions: [{ commandId: sent.commandId, supersedesCommandId: null, domain: "assignment", effectiveServerMs: sent.effectiveServerMs, assignments: [{ ...state.assignments[0], channelId: null }] }] });
  const futureSnapshot = await futureAdapter.getSnapshot();
  assert.equal(futureAdapter.pending()[0].status, "confirmed");
  assert.equal(futureSnapshot.pendingActions.length, 1);
  logs.push({ case: "future scheduled assignment", adapterStatus: futureAdapter.pending()[0].status, serverPendingActions: futureSnapshot.pendingActions.length, millisecondsUntilEffect: sent.effectiveServerMs - state.serverMs });

  // 3. A slow older response overwrites a newer epoch/revision and contaminates the next command.
  const responseResolvers = [];
  let panicBody;
  globalThis.fetch = (_url, init) => {
    if (init?.method === "POST") { panicBody = JSON.parse(init.body); return Promise.resolve(reply(accepted(panicBody))); }
    return new Promise(resolve => responseResolvers.push(resolve));
  };
  const raceAdapter = createAdapter("http://review.invalid");
  const oldRequest = raceAdapter.getSnapshot();
  const freshRequest = raceAdapter.getSnapshot();
  responseResolvers[1](reply(snapshot(1, "new-epoch")));
  await freshRequest;
  responseResolvers[0](reply(snapshot(30, "old-epoch")));
  await oldRequest;
  await raceAdapter.panic();
  assert.equal(panicBody.serverEpoch, "old-epoch");
  assert.equal(panicBody.expectedRevision, 30);
  logs.push({ case: "out-of-order snapshot across restart", nextCommandEpoch: panicBody.serverEpoch, nextCommandRevision: panicBody.expectedRevision, expectedEpoch: "new-epoch" });

  // 4. The frozen HTTP mutation response is valid, but calibration adapter expects additional data.
  globalThis.fetch = async (_url, init) => init?.method === "POST" ? reply(accepted(JSON.parse(init.body))) : reply(snapshot(40));
  const contractAdapter = createAdapter("http://review.invalid");
  await contractAdapter.getSnapshot();
  const created = await contractAdapter.createCalibration([0], { zero: "#0000ff", one: "#ff0000", neutral: "#000000" }, "palette-v1");
  assert.equal(CommandAccepted.safeParse(created).success, true);
  assert.equal(created.runId, undefined);
  assert.equal(created.runTag, undefined);
  const job = await contractAdapter.createJob("run-review", ["upload-review"]);
  assert.equal(CommandAccepted.safeParse(job).success, true);
  assert.equal(job.jobId, undefined);
  logs.push({ case: "contract-compliant mutations", calibrationRunId: created.runId ?? null, calibrationRunTag: created.runTag ?? null, jobId: job.jobId ?? null, responseSchema: "CommandAccepted" });

  // 5. Snapshot-to-offset conversion includes full response delay and makes showhead move backward.
  let localMs = 1200;
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { timeOrigin: 0, now: () => localMs } });
  syncFromServerMs(1000); // generated at 1000; received 200 ms later
  const laggedTime = nowServerMs();
  assert.equal(laggedTime, 1000);
  localMs = 2600;
  const beforePoll = showPositionMs({ status: "playing", positionMs: 0, startServerMs: 0 });
  syncFromServerMs(2000); // next response delayed by 600 ms
  const afterPoll = showPositionMs({ status: "playing", positionMs: 0, startServerMs: 0 });
  assert.equal(beforePoll, 2400);
  assert.equal(afterPoll, 2000);
  logs.push({ case: "snapshot clock response latency", firstServerEstimate: laggedTime, trueServerAtFirstReceipt: 1200, showheadBeforePoll: beforePoll, showheadAfterPoll: afterPoll, backwardJumpMs: beforePoll - afterPoll });
  console.log(JSON.stringify({ reviewedHead: "30054a6b8cf310a943dafa8954e24162f57618ba", checks: logs }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "performance", { configurable: true, value: originalPerformance });
}
