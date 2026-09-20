import { expect, test } from "bun:test";
import { Show, type LocationData, type AudienceSectionId } from "@orchestra/contracts";
import fixture from "../../fixtures/show.json";
import { CheckpointFile } from "../src/checkpoint";
import { DeviceRegistry } from "../src/registry";
import { SessionState } from "../src/state";
import { handleClientMessage } from "../src/messages";
import { validateShow } from "../src/show-validation";

const clock = { sessionId: "sections", serverEpoch: "epoch", nowServerMs: () => 10000 };
const located = (deviceId: number, x: number): LocationData => ({ deviceId, status: "localized", column: "center", x, y: 0.5,
  sourceCameraIds: ["camera"], decodeScore: 1, mappingResidualPx: null, mappingMode: "frame-layout" });
function setup() {
  const state = new SessionState(); const registry = new DeviceRegistry();
  for (let id = 0; id < 10; id++) { registry.join(undefined, 0); state.register(id); }
  state.saveShow(Show.parse(fixture));
  return { state, registry };
}
const commit = (state: SessionState, locations = Array.from({ length: 8 }, (_, id) => located(id, id < 6 ? id / 50 : id / 8)), targets = Array.from({ length: 8 }, (_, id) => id), runTag = 0) =>
  state.commitMap({ runId: `run-${runTag}`, runTag, evidence: "synthetic", locations, targets });
const choose = (state: SessionState, deviceId: number, section: AudienceSectionId | null) => handleClientMessage({
  state, deviceId, clock, receivedServerMs: 10000, raw: JSON.stringify({ protocolVersion: 1, sessionId: clock.sessionId,
    serverEpoch: clock.serverEpoch, messageId: "section-choice", type: "participant.section", payload: { section } }),
});

test("committing calibration automatically assigns count quartiles to the saved presets", () => {
  const { state } = setup();
  state.saveShow({ ...state.show, sectionChannels: { left: "channel-2", "center-left": "channel-0", "center-right": null, right: "channel-1" } });
  commit(state);
  expect(state.audienceMap.sections?.map(member => [member.deviceId, member.section])).toEqual([
    [0, "left"], [1, "left"], [2, "center-left"], [3, "center-left"], [4, "center-right"], [5, "center-right"], [6, "right"], [7, "right"],
  ]);
  expect(Array.from({ length: 8 }, (_, id) => state.assignmentOf(id)?.channelId)).toEqual([
    "channel-2", "channel-2", "channel-0", "channel-0", null, null, "channel-1", "channel-1",
  ]);
  expect(state.participantSnapshot(4, clock)?.audienceSection).toBe("center-right");
  expect(state.assignmentOf(9)?.channelId).toBeNull();
  expect(state.pendingActions).toEqual([]);
});

test("saving presets reroutes existing groups without another calibration, and rejects unknown channels", () => {
  const { state } = setup(); commit(state);
  const previousMap = state.audienceMap;
  const show = { ...state.show, sectionChannels: { left: "channel-1", "center-left": null, "center-right": "channel-2", right: "channel-0" } };
  expect(validateShow(show)).toBeNull();
  state.saveShow(show);
  expect(state.channelMembers("channel-1")).toEqual([0, 1]);
  expect(state.channelMembers("channel-2")).toEqual([4, 5]);
  expect(state.audienceMap).toEqual(previousMap);
  expect(validateShow({ ...show, sectionChannels: { ...show.sectionChannels, right: "missing" } })).toContain("unknown musical channel");
});

test("partial recalibration rebalances all recognized phones and clears newly unrecognized targets", () => {
  const { state } = setup(); commit(state);
  commit(state, [located(0, 0.99)], [0, 1], 1);
  expect(state.audienceMap.sections?.map(member => member.deviceId)).toEqual([2, 3, 4, 5, 6, 7, 0]);
  expect(state.participantSnapshot(0, clock)?.audienceSection).toBe("right");
  expect(state.assignmentOf(0)?.channelId).toBe("channel-2");
  expect(state.participantSnapshot(1, clock)?.audienceSection).toBeNull();
  expect(state.assignmentOf(1)?.channelId).toBeNull();
  expect(state.participantSnapshot(2, clock)?.location.x).toBe(0.04);
});

test("four-section fallback follows its preset, keeps null coordinates and cannot override an optical position", () => {
  const { state } = setup(); commit(state);
  const reply = choose(state, 8, "center-right");
  expect(reply.type).toBe("state.snapshot");
  expect(state.participantSnapshot(8, clock)?.audienceSection).toBe("center-right");
  expect(state.participantSnapshot(8, clock)?.location).toMatchObject({ status: "coarse", x: null, y: null, mappingMode: "manual-column" });
  expect(state.pendingAssignmentFor(8)?.assignment.channelId).toBe("channel-1");
  expect(state.pendingAssignmentFor(8)?.effectiveServerMs).toBe(12000);
  choose(state, 8, "center-right");
  expect(state.pendingAssignmentFor(8)?.effectiveServerMs).toBe(12000);
  const mapBefore = state.audienceMap;
  choose(state, 0, "right");
  expect(state.audienceMap).toEqual(mapBefore);
  state.applyDue(12000);
  state.saveShow({ ...state.show, sectionChannels: { left: null, "center-left": null, "center-right": "channel-2", right: null } });
  expect(state.assignmentOf(8)?.channelId).toBe("channel-2");
  choose(state, 8, null); state.applyDue(12000);
  expect(state.assignmentOf(8)?.channelId).toBeNull();
});

test("section source, routing and saved presets survive a checkpoint; older maps derive quartiles", () => {
  const { state, registry } = setup(); commit(state); choose(state, 8, "right");
  const data = CheckpointFile.parse(registry.toCheckpoint(clock.sessionId, state.durableShow, state.audienceMap,
    state.lastCommittedRunTag, state.durableAssignments, 1));
  const restored = new SessionState(); for (let id = 0; id < 10; id++) restored.register(id);
  restored.restoreShow(data.show!); restored.restoreMap(data.map!, data.committedRunTag); restored.restoreAssignments(data.assignments);
  restored.applySectionRouting();
  const sortedMembers = (value: SessionState) => [...value.audienceMap.sections!].sort((a, b) => a.deviceId - b.deviceId);
  expect(sortedMembers(restored)).toEqual(sortedMembers(state));
  expect(restored.assignmentOf(8)?.channelId).toBe("channel-2");
  expect(restored.transport.status).toBe("stopped");
  const old = { ...data.map! }; delete old.sections;
  restored.restoreMap(old, 0);
  expect(restored.audienceMap.sections).toHaveLength(8);
});

test("section choices cannot inject an ID/channel or use a stale epoch", () => {
  const { state } = setup();
  const message = { protocolVersion: 1, sessionId: clock.sessionId, serverEpoch: clock.serverEpoch,
    messageId: "choice", type: "participant.section", payload: { section: "left" } };
  for (const invalid of [{ ...message, serverEpoch: "old" }, { ...message, payload: { section: "left", deviceId: 2 } },
    { ...message, payload: { section: "left", channelId: "channel-2" } }]) {
    expect(handleClientMessage({ state, clock, deviceId: 0, receivedServerMs: 10000, raw: JSON.stringify(invalid) }).type).toBe("error");
  }
  expect(choose(state, 99, "left").type).toBe("error");
  expect(state.audienceMap.sections).toEqual([]);
});
