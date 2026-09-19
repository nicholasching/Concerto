import { z } from "zod";
import * as models from "./models";
import { ClientMessage, ServerMessage } from "./messages";

export * from "./models";
export * from "./messages";
export const schemas = {
  JoinRequest: models.JoinRequest, JoinResponse: models.JoinResponse, ApiError: models.ApiError,
  CommandAccepted: models.CommandAccepted, Show: models.Show, Transport: models.Transport,
  Assignment: models.Assignment, DeviceReadiness: models.DeviceReadiness, Location: models.Location,
  AudienceMap: models.AudienceMap, CalibrationPlan: models.CalibrationPlan, CalibrationRun: models.CalibrationRun,
  CalibrationManifest: models.CalibrationManifest, OtcResult: models.OtcResult, JobProgress: models.JobProgress,
  Snapshot: models.Snapshot, AdminSnapshot: models.AdminSnapshot, ParticipantSnapshot: models.ParticipantSnapshot,
  AssignmentRequest: models.AssignmentRequest, TransportRequest: models.TransportRequest,
  MixRequest: models.MixRequest, SaveShowRequest: models.SaveShowRequest, PanicRequest: models.PanicRequest,
  CalibrationCreateRequest: models.CalibrationCreateRequest, CalibrationArmRequest: models.CalibrationArmRequest,
  CommitMapRequest: models.CommitMapRequest, CreateJobRequest: models.CreateJobRequest,
  CalibrationCreated: models.CalibrationCreated, CalibrationResource: models.CalibrationResource,
  CameraUploadReceipt: models.CameraUploadReceipt, JobResource: models.JobResource,
  PreparationStatus: models.PreparationStatus,
  ClientMessage, ServerMessage,
};
export type SchemaName = keyof typeof schemas;
export type ShowData = z.infer<typeof models.Show>;
export type LocationData = z.infer<typeof models.Location>;
export type CalibrationManifestData = z.infer<typeof models.CalibrationManifest>;
export type OtcResultData = z.infer<typeof models.OtcResult>;
export type SnapshotData = z.infer<typeof models.Snapshot>;
export type AdminSnapshotData = z.infer<typeof models.AdminSnapshot>;
export type ParticipantSnapshotData = z.infer<typeof models.ParticipantSnapshot>;
export type ClientMessageData = z.infer<typeof ClientMessage>;
export type ServerMessageData = z.infer<typeof ServerMessage>;

// Shape validation is shared with Python. Cross-object state/authorization checks
// (membership, references, unique IDs, revisions, timing) belong to the state owner.
