import { z } from "zod";
import {
  AdminSnapshot, Assignment, Channel, DeviceReadiness, Location, ParticipantSnapshot, PendingAction, PROTOCOL_VERSION, Show, Transport,
  type AdminSnapshotData, type ParticipantSnapshotData, type ShowData,
} from "@orchestra/contracts";
import type { ServerClock } from "./clock";

type DeviceReadinessData = z.infer<typeof DeviceReadiness>;
type AssignmentData = z.infer<typeof Assignment>;
type ChannelData = z.infer<typeof Channel>;
type LocationData = z.infer<typeof Location>;
type PendingActionData = z.infer<typeof PendingAction>;

interface PendingAssignment {
  commandId: string;
  effectiveServerMs: number;
  supersedesCommandId: string | null;
  assignment: AssignmentData;
}

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
  private pendingTransport: Extract<PendingActionData, { domain: "transport" }> | null = null;
  private pendingMix: Extract<PendingActionData, { domain: "mix" }> | null = null;
  private readonly pendingAssignments = new Map<number, PendingAssignment>();
  private assignmentRevisionCounter = 0;
  private mixRevisionCounter = 0;
  private channelState: ChannelData[] | null = null;
  private masterGainState = 1;
  private readonly readiness = new Map<number, DeviceReadinessData>();
  private readonly assignments = new Map<number, AssignmentData>();
  private readonly locations = new Map<number, LocationData>();

  get revision(): number {
    return this.revisionCounter;
  }

  // Committed mix lives on the show's channels, which is where the contract can express it.
  // Asset timing is never touched by a mix change.
  get show(): ShowData {
    const base = this.savedShow ?? PLACEHOLDER_SHOW;
    return this.channelState ? { ...base, channels: this.channelState } : base;
  }

  // The snapshot has no field for master gain, so a reconnecting client cannot recover it from
  // state; it only ever sees it on a mix.commit broadcast. Recorded as a contract gap.
  get masterGain(): number {
    return this.masterGainState;
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
    const actions: PendingActionData[] = [];
    if (this.pendingTransport) actions.push(this.pendingTransport);
    if (this.pendingMix) actions.push(this.pendingMix);
    // Devices scheduled by one command are reported as that one pending action.
    const byCommand = new Map<string, PendingAssignment[]>();
    for (const entry of this.pendingAssignments.values()) {
      const group = byCommand.get(entry.commandId) ?? [];
      group.push(entry);
      byCommand.set(entry.commandId, group);
    }
    for (const [commandId, group] of byCommand) {
      actions.push(PendingAction.parse({
        domain: "assignment", commandId, effectiveServerMs: group[0].effectiveServerMs,
        supersedesCommandId: group[0].supersedesCommandId,
        assignments: group.map(entry => entry.assignment).sort((a, b) => a.deviceId - b.deviceId),
      }));
    }
    return actions;
  }

  pendingIn(domain: PendingActionData["domain"]): PendingActionData | undefined {
    return this.pendingActions.find(action => action.domain === domain);
  }

  pendingAssignmentFor(deviceId: number): PendingAssignment | undefined {
    return this.pendingAssignments.get(deviceId);
  }

  // A replacement cancels only the previous change in the same domain. An unrelated domain is
  // untouched, so scheduling a mix change cannot cancel a transport start that was already
  // accepted, however close together the two commands arrive.
  scheduleTransport(action: Extract<PendingActionData, { domain: "transport" }>): string | null {
    const superseded = this.pendingTransport?.commandId ?? null;
    this.pendingTransport = PendingAction.parse({ ...action, supersedesCommandId: superseded }) as typeof action;
    this.revisionCounter++;
    return superseded;
  }

  scheduleMix(action: Extract<PendingActionData, { domain: "mix" }>): string | null {
    const superseded = this.pendingMix?.commandId ?? null;
    this.pendingMix = PendingAction.parse({ ...action, supersedesCommandId: superseded }) as typeof action;
    this.mixRevisionCounter = action.mixRevision;
    this.revisionCounter++;
    return superseded;
  }

  // One pending assignment per device: reassigning a device cancels only that device's pending
  // change, leaving other devices in the earlier command still scheduled.
  scheduleAssignments(input: {
    commandId: string;
    effectiveServerMs: number;
    assignments: AssignmentData[];
  }): string[] {
    const superseded = new Set<string>();
    for (const assignment of input.assignments) {
      const previous = this.pendingAssignments.get(assignment.deviceId);
      if (previous) superseded.add(previous.commandId);
      this.pendingAssignments.set(assignment.deviceId, {
        commandId: input.commandId,
        effectiveServerMs: input.effectiveServerMs,
        supersedesCommandId: previous?.commandId ?? null,
        assignment: Assignment.parse(assignment),
      });
    }
    this.assignmentRevisionCounter = input.assignments[0]?.assignmentRevision ?? this.assignmentRevisionCounter;
    this.revisionCounter++;
    return [...superseded];
  }

  get assignmentRevision(): number {
    return this.assignmentRevisionCounter;
  }

  get mixRevision(): number {
    return this.mixRevisionCounter;
  }

  // Promotes any pending action whose moment has arrived. Called from the scheduler and before
  // building a snapshot, so a reader never sees a pending action whose time has already passed.
  applyDue(nowServerMs: number): void {
    if (this.pendingTransport && this.pendingTransport.effectiveServerMs <= nowServerMs) {
      this.transportState = this.pendingTransport.transport;
      this.pendingTransport = null;
      this.revisionCounter++;
    }
    if (this.pendingMix && this.pendingMix.effectiveServerMs <= nowServerMs) {
      this.channelState = this.pendingMix.channels;
      this.masterGainState = this.pendingMix.masterGain;
      this.pendingMix = null;
      this.revisionCounter++;
    }
    for (const [deviceId, entry] of [...this.pendingAssignments]) {
      if (entry.effectiveServerMs > nowServerMs) continue;
      this.assignments.set(deviceId, entry.assignment);
      this.pendingAssignments.delete(deviceId);
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

  isRegistered(deviceId: number): boolean {
    return this.readiness.has(deviceId);
  }

  assignmentOf(deviceId: number): AssignmentData | undefined {
    return this.assignments.get(deviceId);
  }

  // Membership is derived from committed assignments only. A phone joins a channel by being
  // assigned to it, never by asking for it.
  channelMembers(channelId: string): number[] {
    return [...this.assignments.values()]
      .filter(assignment => assignment.channelId === channelId)
      .map(assignment => assignment.deviceId)
      .sort((a, b) => a - b);
  }

  // Team 3 commits the real map in a later slice; until then every device is unlocalized.
  get mapRevision(): number {
    return 0;
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
