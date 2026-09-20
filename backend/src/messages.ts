import { PROTOCOL_VERSION, ClientMessage, type ServerMessageData } from "@orchestra/contracts";
import type { ServerClock } from "./clock";
import type { CalibrationRuns } from "./calibration";
import type { Preparations } from "./preparations";
import type { SessionState } from "./state";

const envelope = (clock: ServerClock) => ({
  protocolVersion: PROTOCOL_VERSION,
  sessionId: clock.sessionId,
  serverEpoch: clock.serverEpoch,
  messageId: crypto.randomUUID(),
});

const error = (clock: ServerClock, code: string, message: string): ServerMessageData => ({
  ...envelope(clock),
  type: "error",
  payload: { protocolVersion: PROTOCOL_VERSION, error: { code, message, retryable: false, owner: "sync-control" } },
});

/**
 * `receivedServerMs` is sampled by the socket before parsing, and t2 immediately before
 * returning, so the reply reports the real server-side residence time.
 *
 * `deviceId` is the identity the socket authenticated as. Nothing in the payload can change it.
 */
export const handleClientMessage = (input: {
  raw: string;
  receivedServerMs: number;
  clock: ServerClock;
  deviceId: number;
  state: SessionState;
  preparations?: Preparations;
  calibrations?: CalibrationRuns;
}): ServerMessageData => {
  const { raw, receivedServerMs, clock, deviceId, state, preparations, calibrations } = input;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return error(clock, "INVALID_JSON", "Message was not valid JSON.");
  }

  const message = ClientMessage.safeParse(parsed);
  if (!message.success) return error(clock, "INVALID_MESSAGE", "Message did not match the protocol v1 client schema.");
  if (message.data.sessionId !== clock.sessionId) {
    return error(clock, "WRONG_SESSION", "Message belongs to a different concert session.");
  }

  if (message.data.type === "clock.probe") {
    // A probe carrying a stale serverEpoch is answered, not rejected: the reply is how a
    // reconnecting client discovers the new epoch and discards measurements from the old one.
    const { probeGroupId, probeGroupIndex, t0 } = message.data.payload;
    return {
      ...envelope(clock),
      type: "clock.reply",
      payload: { probeGroupId, probeGroupIndex, t0, t1: receivedServerMs, t2: clock.nowServerMs() },
    };
  }

  if (message.data.serverEpoch !== clock.serverEpoch) {
    return error(clock, "STALE_EPOCH", "Resynchronize before reporting state for this server epoch.");
  }

  if (message.data.type === "participant.section") {
    if (!state.isRegistered(deviceId)) return error(clock, "UNKNOWN_DEVICE", "This device is not registered in the current session.");
    state.chooseSection(deviceId, message.data.payload.section, clock.nowServerMs());
    const snapshot = state.participantSnapshot(deviceId, clock)!;
    return { ...envelope(clock), type: "state.snapshot", revision: snapshot.revision, payload: snapshot };
  }

  if (message.data.type === "participant.column") {
    if (!state.isRegistered(deviceId)) return error(clock, "UNKNOWN_DEVICE", "This device is not registered in the current session.");
    state.chooseColumn(deviceId, message.data.payload.column, clock.nowServerMs());
    const snapshot = state.participantSnapshot(deviceId, clock)!;
    return { ...envelope(clock), type: "state.snapshot", revision: snapshot.revision, payload: snapshot };
  }

  if (message.data.type === "assets.ready") {
    const payload = message.data.payload;
    const barrier = preparations?.current("assets");
    if (!barrier || payload.showRevision !== state.showRevision || payload.preparationId !== barrier.preparationId) return error(clock, "STALE_PREPARATION", "Asset preparation was replaced.");
    const verified = state.show.tracks.every(track => payload.trackHashes[track.trackId] === track.sha256);
    barrier.acknowledgePreparation({ deviceId, preparationId: payload.preparationId, ready: payload.ready && verified,
      reason: verified ? payload.reason : "assets-missing" });
    const snapshot = state.participantSnapshot(deviceId, clock)!;
    return { ...envelope(clock), type: "state.snapshot", revision: snapshot.revision, payload: snapshot };
  }

  if (message.data.type === "calibration.result") {
    const run = calibrations?.get(message.data.payload.runId);
    if (!run || !run.plan.participantIds.includes(deviceId) || run.startServerMs === null) return error(clock, "STALE_CALIBRATION", "No armed calibration for this device.");
    if (run.status === "discarded" || run.status === "committed") return error(clock, "STALE_CALIBRATION", "This calibration run is closed.");
    const { completed, maxFrameLatenessMs, reason } = message.data.payload;
    run.reports.set(deviceId, { deviceId, completed, maxFrameLatenessMs, reason });
    const snapshot = state.participantSnapshot(deviceId, clock)!;
    return { ...envelope(clock), type: "state.snapshot", revision: snapshot.revision, payload: snapshot };
  }

  if (message.data.type === "device.status") {
    if (message.data.payload.deviceId !== deviceId) {
      return error(clock, "DEVICE_MISMATCH", "A socket may only report status for the device it authenticated as.");
    }
    state.applyStatus(deviceId, message.data.payload);
    const status = message.data.payload;
    if (!status.foreground || !status.clockReady) preparations?.current("calibration")?.exclude(deviceId, "clock or foreground no longer ready");
    if (!status.foreground || !status.clockReady || !status.audioUnlocked) {
      preparations?.current("transport")?.exclude(deviceId, "audio, clock or foreground no longer ready");
      preparations?.current("assignment")?.exclude(deviceId, "audio, clock or foreground no longer ready");
    }
    const snapshot = state.participantSnapshot(deviceId, clock);
    if (!snapshot) return error(clock, "UNKNOWN_DEVICE", "This device is not registered in the current session.");
    return { ...envelope(clock), type: "state.snapshot", revision: snapshot.revision, payload: snapshot };
  }

  if (message.data.type === "transport.ready") {
    const barrier = preparations?.current("transport");
    const payload = message.data.payload;
    // An acknowledgement that names a superseded preparation, or revisions the barrier was not
    // issued for, is ignored. It must not be able to satisfy the current barrier late.
    const counted = barrier?.acknowledge({
      deviceId,
      preparationId: payload.preparationId,
      ready: payload.ready,
      reason: payload.reason,
      showRevision: payload.showRevision,
      transportRevision: payload.transportRevision,
    }) ?? false;
    if (!counted) return error(clock, "STALE_PREPARATION", "This acknowledgement does not match the current preparation.");
    const snapshot = state.participantSnapshot(deviceId, clock);
    if (!snapshot) return error(clock, "UNKNOWN_DEVICE", "This device is not registered in the current session.");
    return { ...envelope(clock), type: "state.snapshot", revision: snapshot.revision, payload: snapshot };
  }

  if (message.data.type === "assignment.ready") {
    const payload = message.data.payload;
    const barrier = preparations?.current("assignment");
    if (!barrier || preparations?.assignment?.assignmentRevision !== payload.assignmentRevision
      || !barrier.acknowledgePreparation({ ...payload, deviceId })) {
      return error(clock, "STALE_PREPARATION", "This acknowledgement does not match the current assignment.");
    }
    const snapshot = state.participantSnapshot(deviceId, clock)!;
    return { ...envelope(clock), type: "state.snapshot", revision: snapshot.revision, payload: snapshot };
  }

  if (message.data.type === "calibration.ready") {
    const payload = message.data.payload;
    const barrier = preparations?.current("calibration");
    const activeRunId = calibrations?.activeRun?.plan.runId;
    // Naming a different run means this phone is answering a calibration that is no longer the
    // one being prepared; counting it would put a stale device in the ready set.
    if (!barrier || payload.runId !== activeRunId) {
      return error(clock, "STALE_PREPARATION", "This acknowledgement does not match the current calibration run.");
    }
    if (!barrier.acknowledgePreparation({ deviceId, preparationId: payload.preparationId, ready: payload.ready, reason: payload.reason })) {
      return error(clock, "STALE_PREPARATION", "This acknowledgement does not match the current preparation.");
    }
    const snapshot = state.participantSnapshot(deviceId, clock);
    if (!snapshot) return error(clock, "UNKNOWN_DEVICE", "This device is not registered in the current session.");
    return { ...envelope(clock), type: "state.snapshot", revision: snapshot.revision, payload: snapshot };
  }

  return error(clock, "NOT_IMPLEMENTED", "Team 1 implements this message in a later slice.");
};
