import { z } from "zod";
import {
  AdminSnapshot, Assignment, DeviceReadiness, Location, ParticipantSnapshot, PendingAction, PROTOCOL_VERSION, Show, Transport,
  type AdminSnapshotData, type ParticipantSnapshotData, type ShowData,
} from "@orchestra/contracts";
import type { ServerClock } from "./clock";

type DeviceReadinessData = z.infer<typeof DeviceReadiness>;
type AssignmentData = z.infer<typeof Assignment>;
type LocationData = z.infer<typeof Location>;
type PendingActionData = z.infer<typeof PendingAction>;

// Every snapshot must carry a show holding at least one channel, so a session starts with an
// obviously empty placeholder. Team 4's first saved show replaces it wholesale.
export const PLACEHOLDER_SHOW = Show.parse({
  showId: "placeholder", showRevision: 0, label: "Placeholder: no show saved yet",
  tracks: [], clips: [],
  channels: [{ channelId: "placeholder", label: "Unassigned", color: "#6b7280", gain: 1, mute: false, solo: false }],
});

const stoppedTransport = (transportRevision: number, showRevision: number) =>
  Transport.parse({ status: "stopped", transportRevision, showRevision, positionMs: 0, startServerMs: null });

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
  private savedShow: ShowData | null = null;
  private transportState = stoppedTransport(0, 0);
  private readonly pending = new Map<PendingActionData["domain"], PendingActionData>();
  private readonly readiness = new Map<number, DeviceReadinessData>();
  private readonly assignments = new Map<number, AssignmentData>();
  private readonly locations = new Map<number, LocationData>();

  get revision(): number {
    return this.revisionCounter;
  }

  get show(): ShowData {
    return this.savedShow ?? PLACEHOLDER_SHOW;
  }

  // Null until an operator saves a show; the placeholder is not worth persisting.
  get durableShow(): ShowData | null {
    return this.savedShow;
  }

  get showRevision(): number {
    return this.show.showRevision;
  }

  get transport() {
    return this.transportState;
  }

  // The server assigns the revision. A client cannot choose which version of the show it is
  // writing, only what is in it.
  saveShow(show: ShowData): ShowData {
    this.savedShow = Show.parse({ ...show, showRevision: this.showRevision + 1 });
    this.transportState = stoppedTransport(this.transportState.transportRevision + 1, this.savedShow.showRevision);
    this.revisionCounter++;
    return this.savedShow;
  }

  restoreShow(show: ShowData): void {
    this.savedShow = Show.parse(show);
    this.transportState = stoppedTransport(0, this.savedShow.showRevision);
  }

  get pendingActions(): PendingActionData[] {
    return [...this.pending.values()];
  }

  pendingIn(domain: PendingActionData["domain"]): PendingActionData | undefined {
    return this.pending.get(domain);
  }

  // One pending change per domain. A replacement cancels the previous change in that domain and
  // says which command it superseded; an unrelated domain is untouched, so a mix update cannot
  // cancel a transport start that was already accepted.
  schedule(action: PendingActionData): string | null {
    const superseded = this.pending.get(action.domain)?.commandId ?? null;
    this.pending.set(action.domain, PendingAction.parse({ ...action, supersedesCommandId: superseded }));
    this.revisionCounter++;
    return superseded;
  }

  // Promotes any pending action whose moment has arrived. Called from the scheduler and before
  // building a snapshot, so a reader never sees a pending action whose time has already passed.
  applyDue(nowServerMs: number): void {
    for (const [domain, action] of [...this.pending]) {
      if (action.effectiveServerMs > nowServerMs) continue;
      if (action.domain === "transport") this.transportState = action.transport;
      this.pending.delete(domain);
      this.revisionCounter++;
    }
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

  // Only connected phones are expected to answer a preparation. An operator console is not a
  // device and is never counted as one.
  connectedDeviceIds(): number[] {
    return [...this.readiness.values()].filter(device => device.connected).map(device => device.deviceId);
  }

  private base(clock: ServerClock) {
    return {
      protocolVersion: PROTOCOL_VERSION, sessionId: clock.sessionId, serverEpoch: clock.serverEpoch,
      revision: this.revisionCounter, serverMs: clock.nowServerMs(),
      show: this.show, transport: this.transportState, pendingActions: this.pendingActions,
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
