import { z } from "zod";
import {
  AdminSnapshot, Assignment, DeviceReadiness, Location, ParticipantSnapshot, PROTOCOL_VERSION, Show, Transport,
  type AdminSnapshotData, type ParticipantSnapshotData,
} from "@orchestra/contracts";
import type { ServerClock } from "./clock";

type DeviceReadinessData = z.infer<typeof DeviceReadiness>;
type AssignmentData = z.infer<typeof Assignment>;
type LocationData = z.infer<typeof Location>;

// Every snapshot must carry a show holding at least one channel, so a session starts with an
// obviously empty placeholder. Team 4's first saved show replaces it wholesale.
export const PLACEHOLDER_SHOW = Show.parse({
  showId: "placeholder", showRevision: 0, label: "Placeholder: no show saved yet",
  tracks: [], clips: [],
  channels: [{ channelId: "placeholder", label: "Unassigned", color: "#6b7280", gain: 1, mute: false, solo: false }],
});

const STOPPED_TRANSPORT = Transport.parse({
  status: "stopped", transportRevision: 0, showRevision: 0, positionMs: 0, startServerMs: null,
});

const defaultReadiness = (deviceId: number): DeviceReadinessData => ({
  deviceId, connected: false, foreground: false, clockReady: false,
  clockUncertaintyMs: null, clockSampleAgeMs: null, audioUnlocked: false, decodedTrackHashes: {},
});

const defaultAssignment = (deviceId: number): AssignmentData => ({
  deviceId, channelId: null, assignmentRevision: 0, mapRevision: 0,
});

// Unknown is a real answer. A device that has never been localized is never placed at (0,0).
const defaultLocation = (deviceId: number): LocationData => ({
  deviceId, column: null, sourceCameraIds: [], decodeScore: null, mappingResidualPx: null,
  status: "unseen", x: null, y: null, mappingMode: "none",
});

export class SessionState {
  private revisionCounter = 0;
  private readonly readiness = new Map<number, DeviceReadinessData>();
  private readonly assignments = new Map<number, AssignmentData>();
  private readonly locations = new Map<number, LocationData>();

  get revision(): number {
    return this.revisionCounter;
  }

  register(deviceId: number): void {
    if (this.readiness.has(deviceId)) return;
    this.readiness.set(deviceId, defaultReadiness(deviceId));
    this.assignments.set(deviceId, defaultAssignment(deviceId));
    this.locations.set(deviceId, defaultLocation(deviceId));
    this.revisionCounter++;
  }

  setConnected(deviceId: number, connected: boolean): void {
    const current = this.readiness.get(deviceId);
    if (!current || current.connected === connected) return;
    // A dropped connection invalidates what the phone last claimed about itself.
    this.readiness.set(deviceId, connected ? { ...current, connected } : { ...defaultReadiness(deviceId) });
    this.revisionCounter++;
  }

  applyStatus(deviceId: number, status: DeviceReadinessData): void {
    if (!this.readiness.has(deviceId)) return;
    this.readiness.set(deviceId, DeviceReadiness.parse({ ...status, deviceId }));
    this.revisionCounter++;
  }

  readinessOf(deviceId: number): DeviceReadinessData | undefined {
    return this.readiness.get(deviceId);
  }

  private base(clock: ServerClock) {
    return {
      protocolVersion: PROTOCOL_VERSION, sessionId: clock.sessionId, serverEpoch: clock.serverEpoch,
      revision: this.revisionCounter, serverMs: clock.nowServerMs(),
      show: PLACEHOLDER_SHOW, transport: STOPPED_TRANSPORT, pendingActions: [],
    };
  }

  participantSnapshot(deviceId: number, clock: ServerClock): ParticipantSnapshotData | null {
    const readiness = this.readiness.get(deviceId);
    const assignment = this.assignments.get(deviceId);
    const location = this.locations.get(deviceId);
    if (!readiness || !assignment || !location) return null;
    return ParticipantSnapshot.parse({ ...this.base(clock), role: "participant", deviceId, readiness, assignment, location });
  }

  adminSnapshot(clock: ServerClock): AdminSnapshotData {
    return AdminSnapshot.parse({
      ...this.base(clock), role: "admin",
      // No calibration has run, so the map is empty and labelled synthetic: nothing physical
      // has been measured yet.
      audienceMap: { mapRevision: 0, runId: null, evidence: "synthetic", locations: [...this.locations.values()] },
      devices: [...this.readiness.values()],
      assignments: [...this.assignments.values()],
    });
  }
}
