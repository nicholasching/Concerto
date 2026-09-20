import { expect, test } from "bun:test";
import { Show, type ParticipantSnapshotData } from "@orchestra/contracts";
import fixture from "../../fixtures/show.json";
import { CheckpointFile } from "../src/checkpoint";
import { DeviceRegistry } from "../src/registry";
import { handleClientMessage } from "../src/messages";
import { SessionState } from "../src/state";

function setup() {
  let now = 1_000_000;
  const clock = { sessionId: "manual-test", serverEpoch: "epoch-test", nowServerMs: () => now };
  const state = new SessionState(); state.saveShow(Show.parse(structuredClone(fixture)));
  for (const id of [0, 1, 2, 3]) { state.register(id); state.setConnected(id, true); }
  const choose = (deviceId: number, column: "left" | "center" | "right" | null) => {
    const reply = handleClientMessage({ clock, receivedServerMs: now, state, deviceId,
      raw: JSON.stringify({ protocolVersion: 1, sessionId: clock.sessionId, serverEpoch: clock.serverEpoch,
        messageId: crypto.randomUUID(), type: "participant.column", payload: { column } }) });
    if (reply.type !== "state.snapshot" || reply.payload.role !== "participant") throw new Error("Expected participant snapshot");
    return reply.payload;
  };
  const advance = (ms = 2000) => { now += ms; state.applyDue(now); };
  const ready = (deviceId: number, overrides: Partial<ParticipantSnapshotData["readiness"]> = {}) => state.applyStatus(deviceId, {
    deviceId, connected: true, foreground: true, clockReady: true, clockUncertaintyMs: 2, clockSampleAgeMs: 10,
    audioUnlocked: true, decodedTrackHashes: Object.fromEntries(state.show.tracks.map(track => [track.trackId, track.sha256])), ...overrides,
  });
  const play = () => { state.scheduleTransport({ domain: "transport", commandId: "play", supersedesCommandId: null,
    effectiveServerMs: now, transport: { status: "playing", transportRevision: 2, showRevision: state.showRevision,
      positionMs: 0, startServerMs: now } }, [3]); state.applyDue(now); };
  return { state, clock, choose, advance, ready, play };
}

test("manual section choice schedules the correct musical channel, preserving coarse coordinates", () => {
  const { state, clock, choose, advance } = setup();
  for (const [id, column] of (["left", "center", "right"] as const).entries()) {
    const snapshot = choose(id, column);
    expect(snapshot.location).toMatchObject({ column, mappingMode: "manual-column", x: null, y: null });
    expect(snapshot.assignment.channelId).toBeNull();
    expect(snapshot.pendingActions).toContainEqual(expect.objectContaining({ domain: "assignment", effectiveServerMs: clock.nowServerMs() + 2000,
      assignments: [expect.objectContaining({ deviceId: id, channelId: state.show.channels[id].channelId })] }));
  }
  advance();
  for (const id of [0, 1, 2]) expect(state.assignmentOf(id)?.channelId).toBe(state.show.channels[id].channelId);
});

test("manual section choice matches an existing section assignment instead of its default", () => {
  const { state, clock, choose, advance } = setup();
  state.commitMap({ runId: "run", runTag: 0, evidence: "physical", targets: [3], locations: [{ deviceId: 3,
    status: "coarse", x: null, y: null, column: "left", mappingMode: "optical-column", sourceCameraIds: ["camera"], decodeScore: 1, mappingResidualPx: null }] });
  state.scheduleAssignments({ commandId: "operator", effectiveServerMs: clock.nowServerMs(),
    assignments: [{ deviceId: 3, channelId: state.show.channels[1].channelId, assignmentRevision: 1, mapRevision: state.mapRevision }] });
  advance(0); choose(0, "left"); advance();
  expect(state.assignmentOf(0)?.channelId).toBe(state.show.channels[1].channelId);
});

test("late manual phone remains silent until ready, then sees the existing common playhead", () => {
  const { state, clock, choose, advance, ready, play } = setup();
  play(); advance(3500); choose(0, "center"); advance();
  expect(state.participantSnapshot(0, clock)?.transport.status).toBe("stopped");
  for (const missing of [{ clockReady: false }, { audioUnlocked: false }, { foreground: false }, { decodedTrackHashes: {} }]) {
    ready(0, missing);
    expect(state.participantSnapshot(0, clock)?.transport.status).toBe("stopped");
  }
  ready(0);
  const joined = state.participantSnapshot(0, clock)!;
  expect(joined.transport).toEqual(state.transport);
  expect(clock.nowServerMs() - joined.transport.startServerMs!).toBe(5500);
  expect(joined.assignment.channelId).toBe(state.show.channels[1].channelId);
  ready(1); expect(state.participantSnapshot(1, clock)?.transport.status).toBe("stopped");
  state.panic(); expect(state.participantSnapshot(0, clock)?.transport.status).toBe("stopped");
});

test("legacy and reordered channel IDs resolve by musical part, not array index", () => {
  const { state, choose, advance } = setup();
  const show = structuredClone(state.show);
  show.channels = [...show.channels].reverse().map(channel => ({ ...channel, channelId: `legacy-${channel.label}` }));
  show.clips = []; state.saveShow(show);
  choose(0, "left"); choose(1, "center"); choose(2, "right"); advance();
  expect([0, 1, 2].map(id => state.assignmentOf(id)?.channelId)).toEqual(["legacy-Melody", "legacy-Vocals", "legacy-Percussion"]);
});

test("manual followers track later section assignments; explicit operator clears stay cleared", () => {
  const { state, clock, choose, advance } = setup();
  choose(0, "left"); choose(1, "left"); choose(2, "left"); advance();
  const assign = (id: number, channelId: string | null) => state.scheduleAssignments({ commandId: crypto.randomUUID(), effectiveServerMs: clock.nowServerMs() + 2000,
    assignments: [{ deviceId: id, channelId, assignmentRevision: state.assignmentRevision + 1, mapRevision: state.mapRevision }] });
  assign(0, null); advance();
  assign(1, state.show.channels[2].channelId);
  expect(state.pendingAssignmentFor(2)?.effectiveServerMs).toBe(clock.nowServerMs() + 2000);
  advance();
  expect(state.assignmentOf(0)?.channelId).toBeNull();
  expect(state.assignmentOf(2)?.channelId).toBe(state.show.channels[2].channelId);
  expect(state.manualRoutingDeviceIds).toEqual([2]);
});

test("duplicate choices do not move the assignment deadline; changing and clearing replaces only that phone", () => {
  const { state, choose, advance } = setup();
  choose(0, "left"); choose(1, "center");
  const pending = state.pendingAssignmentFor(0), mapRevision = state.mapRevision;
  advance(500); choose(0, "left");
  expect(state.mapRevision).toBe(mapRevision); expect(state.pendingAssignmentFor(0)).toEqual(pending);
  choose(0, "right"); advance();
  expect(state.assignmentOf(0)?.channelId).toBe(state.show.channels[2].channelId);
  expect(state.assignmentOf(1)?.channelId).toBe(state.show.channels[1].channelId);
  choose(0, null); advance();
  expect(state.assignmentOf(0)?.channelId).toBeNull();
  expect(state.audienceMap.locations.find(location => location.deviceId === 0)?.status).toBe("unseen");
});

test("rescheduling the section changes its followers at the revised shared deadline", () => {
  const { state, clock, choose, advance } = setup();
  choose(0, "left"); choose(1, "left"); advance();
  const assign = (delay: number) => state.scheduleAssignments({ commandId: `reschedule-${delay}`, effectiveServerMs: clock.nowServerMs() + delay,
    assignments: [{ deviceId: 1, channelId: state.show.channels[1].channelId, assignmentRevision: state.assignmentRevision + 1, mapRevision: state.mapRevision }] });
  assign(2000); assign(5000);
  advance(2000); expect(state.assignmentOf(0)?.channelId).toBe(state.show.channels[0].channelId);
  advance(3000); expect(state.assignmentOf(0)?.channelId).toBe(state.show.channels[1].channelId);
});

test("a wave of manual joins does not keep postponing the first phone's routing", () => {
  const { state, clock, choose, advance } = setup();
  choose(3, "left"); advance();
  state.scheduleAssignments({ commandId: "section", effectiveServerMs: clock.nowServerMs() + 1000,
    assignments: [{ deviceId: 3, channelId: state.show.channels[1].channelId, assignmentRevision: state.assignmentRevision + 1, mapRevision: state.mapRevision }] });
  choose(0, "left"); const deadline = state.pendingAssignmentFor(0)!.effectiveServerMs;
  advance(250); choose(1, "left"); advance(250); choose(2, "left");
  expect(state.pendingAssignmentFor(0)?.effectiveServerMs).toBe(deadline);
});

test("a missing musical default stays unassigned instead of selecting an unrelated track", () => {
  const { state, choose, advance } = setup();
  state.saveShow({ ...state.show, channels: [{ ...state.show.channels[0], label: "Custom" }], clips: [] });
  choose(0, "left"); advance(); expect(state.assignmentOf(0)?.channelId).toBeNull();
});

test("tied operator channels use the agreed default, never a majority manufactured by auto-routed phones", () => {
  const { state, clock, choose, advance } = setup();
  for (const id of [0, 1, 2, 3]) choose(id, "center"); advance();
  for (const [id, channel] of [[0, 0], [1, 2]]) state.scheduleAssignments({ commandId: `operator-${id}`, effectiveServerMs: clock.nowServerMs() + 2000,
    assignments: [{ deviceId: id, channelId: state.show.channels[channel].channelId, assignmentRevision: state.assignmentRevision + 1, mapRevision: state.mapRevision }] });
  advance();
  expect(state.assignmentOf(2)?.channelId).toBe(state.show.channels[1].channelId);
  expect(state.assignmentOf(3)?.channelId).toBe(state.show.channels[1].channelId);
});

test("checkpoint restores automatic following and migrates old unassigned manual phones without undoing operator clears", () => {
  const { state, clock, choose, advance } = setup();
  choose(0, "left"); choose(1, "left"); advance();
  state.scheduleAssignments({ commandId: "clear", effectiveServerMs: clock.nowServerMs(),
    assignments: [{ deviceId: 1, channelId: null, assignmentRevision: state.assignmentRevision + 1, mapRevision: state.mapRevision }] }); advance(0);
  const registry = new DeviceRegistry(); for (let n = 0; n < 4; n++) registry.join(undefined, clock.nowServerMs());
  const data = CheckpointFile.parse(registry.toCheckpoint(clock.sessionId, state.durableShow, state.audienceMap, null,
    state.durableAssignments, 0, state.manualRoutingDeviceIds));
  // A pre-fix device has a manual location, but has never had an assignment revision.
  data.map!.locations[2] = { ...data.map!.locations[0], deviceId: 2, column: "right" };
  const restored = new SessionState(); for (const id of [0, 1, 2, 3]) restored.register(id);
  restored.restoreShow(data.show!); restored.restoreMap(data.map!, null); restored.restoreAssignments(data.assignments);
  restored.restoreManualRouting(data.manualRoutingDeviceIds, clock.nowServerMs());
  restored.applyDue(clock.nowServerMs() + 2000);
  expect(restored.manualRoutingDeviceIds).toEqual([0, 2]);
  expect(restored.assignmentOf(1)?.channelId).toBeNull();
  expect(restored.assignmentOf(2)?.channelId).toBe(state.show.channels[2].channelId);
  expect(restored.transport.status).toBe("stopped");
  const { manualRoutingDeviceIds: _oldField, ...oldCheckpoint } = data;
  expect(CheckpointFile.parse(oldCheckpoint).manualRoutingDeviceIds).toEqual([]);
});

test("participant routing rejects stale epochs and arbitrary channel or device ID injection", () => {
  const { state, clock } = setup();
  const message = { protocolVersion: 1, sessionId: clock.sessionId, serverEpoch: clock.serverEpoch, messageId: "choose", type: "participant.column", payload: { column: "left" } };
  for (const invalid of [{ ...message, serverEpoch: "old" }, { ...message, payload: { column: "left", channelId: "channel-2" } },
    { ...message, payload: { column: "left", deviceId: 1 } }]) {
    expect(handleClientMessage({ clock, state, deviceId: 0, receivedServerMs: clock.nowServerMs(), raw: JSON.stringify(invalid) }).type).toBe("error");
  }
  expect(handleClientMessage({ clock, state, deviceId: 99, receivedServerMs: clock.nowServerMs(), raw: JSON.stringify(message) }).type).toBe("error");
  expect(state.mapRevision).toBe(0); expect(state.assignmentRevision).toBe(0);
});

test("pause and panic cannot be undone by a manual selection or a late readiness report", () => {
  const { state, clock, choose, advance, ready, play } = setup();
  play();
  state.scheduleTransport({ domain: "transport", commandId: "pause", supersedesCommandId: null, effectiveServerMs: clock.nowServerMs(),
    transport: { status: "paused", transportRevision: 3, showRevision: state.showRevision, positionMs: 900, startServerMs: null } });
  advance(0); choose(0, "left"); advance(); ready(0);
  expect(state.participantSnapshot(0, clock)?.transport.status).toBe("paused");
  state.panic(); choose(1, "right"); advance(); ready(1);
  expect(state.participantSnapshot(1, clock)?.transport.status).toBe("stopped");
});
