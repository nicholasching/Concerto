import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const Id = z.string().min(1).max(160);
export const DeviceId = z.number().int().min(0).max(2047);
export const Revision = z.number().int().nonnegative();
export const Milliseconds = z.number().nonnegative();
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const Column = z.enum(["left", "center", "right"]);
export const Point = z.strictObject({ x: z.number(), y: z.number() });
export const ParticipantIds = z.array(DeviceId).max(2048);
export const SessionIdentity = { protocolVersion: z.literal(1), sessionId: Id, serverEpoch: Id };

export const JoinRequest = z.strictObject({ resumeToken: z.string().min(16).optional() });
export const JoinResponse = z.strictObject({
  ...SessionIdentity, deviceId: DeviceId, resumeToken: z.string().min(16), revision: Revision,
});
export const ApiError = z.strictObject({
  protocolVersion: z.literal(1),
  error: z.strictObject({ code: Id, message: z.string(), retryable: z.boolean(), owner: z.string().optional() }),
});
export const CommandContext = {
  ...SessionIdentity, commandId: Id, expectedRevision: Revision,
};
export const CommandAccepted = z.strictObject({
  ...SessionIdentity, commandId: Id, revision: Revision,
  effectiveServerMs: Milliseconds.optional(), preparationId: Id.optional(),
  supersededCommandIds: z.array(Id).optional(),
  ready: z.number().int().nonnegative().optional(),
  excluded: z.array(z.strictObject({ deviceId: DeviceId, reason: z.string() })).optional(),
});

export const Track = z.strictObject({
  trackId: Id, label: z.string(), url: z.string().min(1), sha256: Sha256,
  byteSize: z.number().int().positive(), durationMs: z.number().positive(),
  sampleRateHz: z.number().int().positive(), channels: z.number().int().min(1).max(2),
});
export const Channel = z.strictObject({
  channelId: Id, label: z.string(), color: Color, gain: z.number().min(0).max(1),
  mute: z.boolean(), solo: z.boolean(),
});
export const Clip = z.strictObject({
  clipId: Id, channelId: Id, trackId: Id, timelineStartMs: Milliseconds,
  sourceOffsetMs: Milliseconds, durationMs: z.number().positive(), gain: z.number().min(0).max(1),
});
export const Show = z.strictObject({
  showId: Id, showRevision: Revision, label: z.string(),
  tracks: z.array(Track), channels: z.array(Channel).min(1), clips: z.array(Clip),
  cueMarkers: z.array(z.strictObject({ cueId: Id, label: z.string().min(1).max(100), positionMs: Milliseconds })).max(100).optional(),
});
export const Transport = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("stopped"), transportRevision: Revision, showRevision: Revision, positionMs: z.literal(0), startServerMs: z.null() }),
  z.strictObject({ status: z.literal("paused"), transportRevision: Revision, showRevision: Revision, positionMs: Milliseconds, startServerMs: z.null() }),
  z.strictObject({ status: z.literal("playing"), transportRevision: Revision, showRevision: Revision, positionMs: Milliseconds, startServerMs: Milliseconds }),
]);
export const Assignment = z.strictObject({
  deviceId: DeviceId, channelId: Id.nullable(), assignmentRevision: Revision, mapRevision: Revision,
});
export const DeviceReadiness = z.strictObject({
  deviceId: DeviceId, connected: z.boolean(), foreground: z.boolean(), clockReady: z.boolean(),
  clockUncertaintyMs: Milliseconds.nullable(), clockSampleAgeMs: Milliseconds.nullable(),
  audioUnlocked: z.boolean(), decodedTrackHashes: z.record(Id, Sha256),
});

const locationBase = {
  deviceId: DeviceId, column: Column.nullable(), sourceCameraIds: z.array(Id),
  decodeScore: z.number().min(0).max(1).nullable(), mappingResidualPx: Milliseconds.nullable(),
};
export const Location = z.discriminatedUnion("status", [
  z.strictObject({ ...locationBase, status: z.literal("localized"), x: z.number().min(0).max(1), y: z.number().min(0).max(1), mappingMode: z.enum(["manual-anchors", "overlap", "frame-layout"]) }),
  z.strictObject({ ...locationBase, status: z.literal("coarse"), column: Column, x: z.null(), y: z.null(), mappingMode: z.enum(["manual-column", "optical-column"]) }),
  z.strictObject({ ...locationBase, status: z.literal("ambiguous"), x: z.null(), y: z.null(), mappingMode: z.literal("none") }),
  z.strictObject({ ...locationBase, status: z.literal("unseen"), x: z.null(), y: z.null(), mappingMode: z.literal("none") }),
]);
export const AudienceMap = z.strictObject({
  mapRevision: Revision, runId: Id.nullable(), evidence: z.enum(["synthetic", "physical"]),
  locations: z.array(Location).max(2048),
});

export const Palette = z.strictObject({ zero: Color, one: Color, neutral: Color });
const calibrationBase = {
  ...SessionIdentity, runId: Id, runTag: z.number().int().min(0).max(255),
  participantIds: ParticipantIds,
  codebookVersion: z.literal("hamming16-11-v1"), paletteVersion: Id,
  palette: Palette,
};
const LegacyCalibrationPlan = z.strictObject({ ...calibrationBase, packetVersion: z.literal("otc-v1"), symbolMs: z.literal(200) });
const CurrentCalibrationPlan = z.strictObject({ ...calibrationBase, packetVersion: z.literal("otc-v2"), symbolMs: z.literal(250) });
export const CalibrationPlan = z.discriminatedUnion("packetVersion", [LegacyCalibrationPlan, CurrentCalibrationPlan]);
const LegacyCalibrationRun = LegacyCalibrationPlan.extend({ startServerMs: Milliseconds });
const CurrentCalibrationRun = CurrentCalibrationPlan.extend({ startServerMs: Milliseconds });
export const CalibrationRun = z.discriminatedUnion("packetVersion", [LegacyCalibrationRun, CurrentCalibrationRun]);
export const CameraInput = z.strictObject({
  cameraId: Id, primaryColumn: Column, videoPath: z.string().min(1), sha256: Sha256,
  rotationDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  exclusionRois: z.array(z.array(Point).min(3)),
  anchors: z.tuple([Point, Point, Point, Point]).nullable(),
  frameLayout: z.enum(["from-stage", "from-back"]).optional(),
});
const cameraFields = { cameras: z.array(CameraInput).min(1).max(3) };
export const CalibrationManifest = z.discriminatedUnion("packetVersion", [LegacyCalibrationRun.extend(cameraFields), CurrentCalibrationRun.extend(cameraFields)]);
export const Observation = z.strictObject({
  cameraId: Id, trackId: Id, deviceId: DeviceId.nullable(),
  status: z.enum(["accepted", "ambiguous", "rejected"]),
  centerPx: Point, firstPtsMs: Milliseconds, lastPtsMs: Milliseconds,
  decodeScore: z.number().min(0).max(1), correctedBits: z.number().int().nonnegative(),
  erasedBits: z.number().int().nonnegative(), reasons: z.array(z.string()),
});
export const CameraDiagnostic = z.strictObject({
  cameraId: Id, frameWidth: z.number().int().positive(), frameHeight: z.number().int().positive(),
  phasePtsMs: z.number().nullable(), acceptedTracks: z.number().int().nonnegative(),
  rejectedTracks: z.number().int().nonnegative(), messages: z.array(z.string()),
});
export const OtcResult = z.strictObject({
  ...SessionIdentity, runId: Id, runTag: z.number().int().min(0).max(255),
  evidence: z.enum(["synthetic", "physical"]), decoderVersion: Id,
  inputHashes: z.array(z.strictObject({ cameraId: Id, sha256: Sha256 })),
  observations: z.array(Observation), locations: z.array(Location).max(2048),
  cameras: z.array(CameraDiagnostic), warnings: z.array(z.string()), processingMs: Milliseconds,
});
export const JobProgress = z.strictObject({
  protocolVersion: z.literal(1), jobId: Id, runId: Id,
  stage: z.enum(["queued", "validate", "decode", "track", "register", "complete", "failed", "cancelled"]),
  progress: z.number().min(0).max(1), message: z.string(),
});

export const PreparationStatus = z.strictObject({
  preparationId: Id, domain: z.enum(["transport", "assets", "assignment", "calibration"]),
  showRevision: Revision, transportRevision: Revision,
  expectedIds: ParticipantIds, readyIds: ParticipantIds,
  excluded: z.array(z.strictObject({ deviceId: DeviceId, reason: z.string() })),
});
export const CameraUploadReceipt = CameraInput.omit({ videoPath: true }).extend({
  uploadId: Id, runId: Id, byteSize: z.number().int().positive(), label: z.string(),
});
export const CalibrationCreated = z.strictObject({ plan: CalibrationPlan, preparationId: Id });
export const CalibrationResource = z.strictObject({
  plan: CalibrationPlan, preparationId: Id,
  status: z.enum(["created", "armed", "processing", "committed", "discarded"]),
  startServerMs: Milliseconds.nullable(), uploads: z.array(CameraUploadReceipt),
  reports: z.array(z.strictObject({ deviceId: DeviceId, completed: z.boolean(), maxFrameLatenessMs: Milliseconds, reason: z.string().nullable() })).default([]),
});
export const JobResource = z.strictObject({ progress: JobProgress, diagnostics: z.array(z.string()), result: OtcResult.nullable() });

const pendingBase = { commandId: Id, effectiveServerMs: Milliseconds, supersedesCommandId: Id.nullable() };
export const PendingAction = z.discriminatedUnion("domain", [
  z.strictObject({ ...pendingBase, domain: z.literal("transport"), transport: Transport }),
  z.strictObject({ ...pendingBase, domain: z.literal("assignment"), assignments: z.array(Assignment) }),
  z.strictObject({ ...pendingBase, domain: z.literal("mix"), mixRevision: Revision, masterGain: z.number().min(0).max(1), channels: z.array(Channel) }),
]);
const snapshotBase = {
  ...SessionIdentity, revision: Revision, serverMs: Milliseconds,
  show: Show, transport: Transport, pendingActions: z.array(PendingAction),
  mix: z.strictObject({ mixRevision: Revision, masterGain: z.number().min(0).max(1) }).default({ mixRevision: 0, masterGain: 1 }),
};
export const AdminSnapshot = z.strictObject({
  ...snapshotBase, role: z.literal("admin"), audienceMap: AudienceMap,
  devices: z.array(DeviceReadiness), assignments: z.array(Assignment),
  assignmentRevision: Revision.default(0),
  preparations: z.array(PreparationStatus).default([]),
  appliedCommandIds: z.array(Id).default([]),
  calibration: CalibrationResource.nullable().default(null),
});
export const ParticipantSnapshot = z.strictObject({
  ...snapshotBase, role: z.literal("participant"), deviceId: DeviceId,
  readiness: DeviceReadiness, assignment: Assignment, location: Location,
  calibrationStage: z.enum(["waiting", "calibrating", "processing", "complete"]).optional(),
});
export const Snapshot = z.discriminatedUnion("role", [AdminSnapshot, ParticipantSnapshot]);

export const AssignmentRequest = z.strictObject({
  ...CommandContext, mapRevision: Revision, deviceIds: ParticipantIds.min(1),
  channelId: Id.nullable(), effectiveServerMs: Milliseconds, preparationId: Id.optional(),
});
export const TransportRequest = z.strictObject({
  ...CommandContext, action: z.enum(["prepare", "play", "pause", "seek", "stop"]),
  showRevision: Revision, positionMs: Milliseconds, effectiveServerMs: Milliseconds,
});
export const MixRequest = z.strictObject({
  ...CommandContext, effectiveServerMs: Milliseconds, masterGain: z.number().min(0).max(1), channels: z.array(Channel),
});
export const SaveShowRequest = z.strictObject({ ...CommandContext, show: Show });
export const PanicRequest = z.strictObject(CommandContext);
export const CalibrationCreateRequest = z.strictObject({ ...CommandContext, participantIds: ParticipantIds.min(1), palette: Palette, paletteVersion: Id });
export const CalibrationArmRequest = z.strictObject({ ...CommandContext, runId: Id, preparationId: Id, effectiveServerMs: Milliseconds });
export const CommitMapRequest = z.strictObject({ ...CommandContext, runId: Id, expectedMapRevision: Revision, jobId: Id });
export const CreateJobRequest = z.strictObject({ ...CommandContext, runId: Id, uploadIds: z.array(Id).min(1).max(3), evidence: z.enum(["physical", "synthetic"]).default("physical") });
