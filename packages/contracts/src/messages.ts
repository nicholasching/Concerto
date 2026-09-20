import { z } from "zod";
import { ApiError, Assignment, AudienceSection, CalibrationPlan, CalibrationRun, Column, DeviceReadiness, Id, Milliseconds, PendingAction, Revision, SessionIdentity, Sha256, Show, Snapshot } from "./models";

const envelope = { ...SessionIdentity, messageId: Id };
const ready = { preparationId: Id, ready: z.boolean(), reason: z.string().nullable() };
const pair = { probeGroupId: z.number().int().nonnegative(), probeGroupIndex: z.union([z.literal(0), z.literal(1)]) };

export const ClientMessage = z.discriminatedUnion("type", [
  z.strictObject({ ...envelope, type: z.literal("clock.probe"), payload: z.strictObject({ ...pair, t0: Milliseconds }) }),
  z.strictObject({ ...envelope, type: z.literal("calibration.ready"), payload: z.strictObject({ ...ready, runId: Id }) }),
  z.strictObject({ ...envelope, type: z.literal("calibration.result"), payload: z.strictObject({ runId: Id, completed: z.boolean(), maxFrameLatenessMs: Milliseconds, reason: z.string().nullable() }) }),
  z.strictObject({ ...envelope, type: z.literal("assets.ready"), payload: z.strictObject({ ...ready, showRevision: Revision, trackHashes: z.record(Id, Sha256) }) }),
  z.strictObject({ ...envelope, type: z.literal("assignment.ready"), payload: z.strictObject({ ...ready, assignmentRevision: Revision }) }),
  z.strictObject({ ...envelope, type: z.literal("transport.ready"), payload: z.strictObject({ ...ready, showRevision: Revision, transportRevision: Revision }) }),
  z.strictObject({ ...envelope, type: z.literal("device.status"), payload: DeviceReadiness }),
  z.strictObject({ ...envelope, type: z.literal("participant.column"), payload: z.strictObject({ column: Column.nullable() }) }),
  z.strictObject({ ...envelope, type: z.literal("participant.section"), payload: z.strictObject({ section: AudienceSection.nullable() }) }),
]);

export const ServerMessage = z.discriminatedUnion("type", [
  z.strictObject({ ...envelope, type: z.literal("error"), payload: ApiError }),
  z.strictObject({ ...envelope, type: z.literal("lease.renew"), payload: z.strictObject({ expiresServerMs: Milliseconds }) }),
  z.strictObject({ ...envelope, type: z.literal("clock.reply"), payload: z.strictObject({ ...pair, t0: Milliseconds, t1: Milliseconds, t2: Milliseconds }) }),
  z.strictObject({ ...envelope, type: z.literal("state.snapshot"), revision: Revision, payload: Snapshot }),
  z.strictObject({ ...envelope, type: z.literal("calibration.prepare"), revision: Revision, payload: z.strictObject({ preparationId: Id, plan: CalibrationPlan }) }),
  z.strictObject({ ...envelope, type: z.literal("calibration.arm"), revision: Revision, effectiveServerMs: Milliseconds, payload: z.strictObject({ preparationId: Id, run: CalibrationRun }) }),
  z.strictObject({ ...envelope, type: z.literal("assets.prepare"), revision: Revision, payload: z.strictObject({ preparationId: Id, show: Show }) }),
  z.strictObject({ ...envelope, type: z.literal("assignment.prepare"), revision: Revision, payload: z.strictObject({ preparationId: Id, assignment: Assignment }) }),
  z.strictObject({ ...envelope, type: z.literal("assignment.commit"), revision: Revision, effectiveServerMs: Milliseconds, payload: PendingAction.options[1] }),
  z.strictObject({ ...envelope, type: z.literal("transport.prepare"), revision: Revision, payload: z.strictObject({ preparationId: Id, showRevision: Revision, transportRevision: Revision }) }),
  z.strictObject({ ...envelope, type: z.literal("transport.commit"), revision: Revision, effectiveServerMs: Milliseconds, payload: PendingAction.options[0] }),
  z.strictObject({ ...envelope, type: z.literal("mix.commit"), revision: Revision, effectiveServerMs: Milliseconds, payload: PendingAction.options[2] }),
  z.strictObject({ ...envelope, type: z.literal("panic"), revision: Revision, payload: z.strictObject({ commandId: Id }) }),
]);
