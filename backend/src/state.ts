import { z } from "zod";
import {
  AdminSnapshot, Assignment, AudienceMap, Channel, DeviceReadiness, Location, ParticipantSnapshot, PendingAction,
  PROTOCOL_VERSION, Show, Transport,
  type AdminSnapshotData, type ParticipantSnapshotData, type ShowData,
} from "@orchestra/contracts";
import type { ServerClock } from "./clock";

type DeviceReadinessData = z.infer<typeof DeviceReadiness>;
type AssignmentData = z.infer<typeof Assignment>;
type ChannelData = z.infer<typeof Channel>;
type LocationData = z.infer<typeof Location>;
type AudienceMapData = z.infer<typeof AudienceMap>;
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
  private pendingActionsCache: PendingActionData[] | null = null;
  private assignmentRevisionCounter = 0;
  private mixRevisionCounter = 0;
  private effectiveMixRevision = 0;
  private readonly transportRecipients = new Map<number, Set<number>>();
  private channelState: ChannelData[] | null = null;
  private masterGainState = 1;
  private mapRevisionCounter = 0;
  private mapRunId: string | null = null;
  private mapEvidence: AudienceMapData["evidence"] = "synthetic";
  private committedRunTag: number | null = null;
  private readonly readiness = new Map<number, DeviceReadinessData>();
  private readonly assignments = new Map<number, AssignmentData>();
  private readonly locations = new Map<number, LocationData>();
  private adminContext: () => Partial<Pick<AdminSnapshotData, "preparations" | "calibration">> = () => ({});
  private readonly appliedCommands = new Set<string>();

  setAdminContext(provider: typeof this.adminContext): void { this.adminContext = provider; }
  private applied(commandId: string): void {
    this.appliedCommands.add(commandId);
    if (this.appliedCommands.size > 1000) this.appliedCommands.delete(this.appliedCommands.values().next().value!);
  }
  get durableAssignments(): AssignmentData[] {
    return [...this.assignments.values()].map(assignment => this.pendingAssignments.get(assignment.deviceId)?.assignment ?? assignment);
  }
  restoreAssignments(assignments: AssignmentData[]): void {
    for (const assignment of assignments) {
      if (!this.isRegistered(assignment.deviceId)) continue;
      this.assignments.set(assignment.deviceId, Assignment.parse(assignment));
      this.assignmentRevisionCounter = Math.max(this.assignmentRevisionCounter, assignment.assignmentRevision);
    }
  }

  get revision(): number {
    return this.revisionCounter;
  }

  // Committed mix lives on the show's channels, which is where the contract can express it.
  // Asset timing is never touched by a mix change.
  get show(): ShowData {
    const base = this.savedShow ?? PLACEHOLDER_SHOW;
    return this.channelState ? { ...base, channels: this.channelState } : base;
  }

  // Effective gain is included in every snapshot; allocated revisions also include pending mix.
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
  get transportRevision(): number { return Math.max(this.transportState.transportRevision, this.pendingTransport?.transport.transportRevision ?? 0); }

  // The server assigns the revision. A client cannot choose which version of the show it is
  // writing, only what is in it.
  saveShow(show: ShowData): ShowData {
    this.pendingMix = null;
    this.channelState = null;
    this.masterGainState = 1;
    this.pendingActionsCache = null;
    this.savedShow = Show.parse({ ...show, showRevision: this.showRevision + 1 });
    for (const [deviceId, assignment] of this.assignments) {
      if (assignment.channelId !== null && !show.channels.some(channel => channel.channelId === assignment.channelId)) {
        this.assignments.set(deviceId, { ...assignment, channelId: null, assignmentRevision: ++this.assignmentRevisionCounter });
      }
    }
    this.transportState = stoppedTransport(this.transportState.transportRevision + 1, this.savedShow.showRevision);
    this.revisionCounter++;
    return this.savedShow;
  }

  restoreShow(show: ShowData): void {
    this.savedShow = Show.parse(show);
    this.transportState = stoppedTransport(0, this.savedShow.showRevision);
  }

  /**
   * Cached deliberately. Every snapshot reads this, and a snapshot is built on every device status
   * message, so rebuilding and re-validating a thousand pending assignments here stalled the event
   * loop under load. The values were already validated when they were scheduled; validating them
   * again on every read bought nothing.
   */
  get pendingActions(): PendingActionData[] {
    if (this.pendingActionsCache) return this.pendingActionsCache;
    const actions: PendingActionData[] = [];
    if (this.pendingTransport) actions.push(this.pendingTransport);
    if (this.pendingMix) actions.push(this.pendingMix);
    const byCommand = new Map<string, PendingAssignment[]>();
    for (const entry of this.pendingAssignments.values()) {
      const group = byCommand.get(entry.commandId) ?? [];
      group.push(entry);
      byCommand.set(entry.commandId, group);
    }
    for (const [commandId, group] of byCommand) {
      actions.push({
        domain: "assignment", commandId, effectiveServerMs: group[0].effectiveServerMs,
        supersedesCommandId: group[0].supersedesCommandId,
        assignments: group.map(entry => entry.assignment).sort((a, b) => a.deviceId - b.deviceId),
      });
    }
    this.pendingActionsCache = actions;
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
  scheduleTransport(action: Extract<PendingActionData, { domain: "transport" }>, recipients?: number[]): string | null {
    const superseded = this.pendingTransport?.commandId ?? null;
    this.pendingTransport = PendingAction.parse({ ...action, supersedesCommandId: superseded }) as typeof action;
    if (recipients) this.transportRecipients.set(action.transport.transportRevision, new Set(recipients));
    for (const revision of this.transportRecipients.keys()) if (revision !== this.transportState.transportRevision && revision !== action.transport.transportRevision) this.transportRecipients.delete(revision);
    this.pendingActionsCache = null;
    this.revisionCounter++;
    return superseded;
  }

  scheduleMix(action: Extract<PendingActionData, { domain: "mix" }>): string | null {
    const superseded = this.pendingMix?.commandId ?? null;
    this.pendingMix = PendingAction.parse({ ...action, supersedesCommandId: superseded }) as typeof action;
    this.mixRevisionCounter = action.mixRevision;
    this.pendingActionsCache = null;
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
    this.pendingActionsCache = null;
    this.revisionCounter++;
    return [...superseded];
  }

  get assignmentRevision(): number {
    return this.assignmentRevisionCounter;
  }

  get mixRevision(): number {
    return this.mixRevisionCounter;
  }

  /**
   * Cancels everything scheduled and stops the transport at once. This is the only state change
   * that does not wait for a common future moment: a scheduled silence is not a panic.
   */
  panic(): void {
    const nextRevision = Math.max(this.transportState.transportRevision, this.pendingTransport?.transport.transportRevision ?? 0) + 1;
    this.pendingTransport = null;
    this.pendingMix = null;
    this.pendingAssignments.clear();
    this.pendingActionsCache = null;
    this.transportState = stoppedTransport(nextRevision, this.showRevision);
    this.revisionCounter++;
  }

  // Promotes any pending action whose moment has arrived. Called from the scheduler and before
  // building a snapshot, so a reader never sees a pending action whose time has already passed.
  applyDue(nowServerMs: number): void {
    if (this.pendingTransport && this.pendingTransport.effectiveServerMs <= nowServerMs) {
      this.applied(this.pendingTransport.commandId);
      this.transportState = this.pendingTransport.transport;
      this.pendingTransport = null;
      this.pendingActionsCache = null;
      this.revisionCounter++;
    }
    if (this.pendingMix && this.pendingMix.effectiveServerMs <= nowServerMs) {
      this.applied(this.pendingMix.commandId);
      this.channelState = this.pendingMix.channels;
      this.masterGainState = this.pendingMix.masterGain;
      this.effectiveMixRevision = this.pendingMix.mixRevision;
      this.pendingMix = null;
      this.pendingActionsCache = null;
      this.revisionCounter++;
    }
    for (const [deviceId, entry] of [...this.pendingAssignments]) {
      if (entry.effectiveServerMs > nowServerMs) continue;
      this.applied(entry.commandId);
      this.assignments.set(deviceId, entry.assignment);
      this.pendingAssignments.delete(deviceId);
      this.pendingActionsCache = null;
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

  chooseColumn(deviceId: number, column: "left" | "center" | "right" | null): void {
    if (!this.isRegistered(deviceId)) return;
    this.locations.set(deviceId, column === null ? defaultLocation(deviceId) : {
      ...defaultLocation(deviceId), status: "coarse", column, mappingMode: "manual-column", x: null, y: null,
    });
    this.mapRevisionCounter++;
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

  get mapRevision(): number {
    return this.mapRevisionCounter;
  }

  // The highest run tag whose result has been committed. A run older than this arriving late must
  // not overwrite newer locations.
  get lastCommittedRunTag(): number | null {
    return this.committedRunTag;
  }

  get audienceMap(): AudienceMapData {
    return AudienceMap.parse({
      mapRevision: this.mapRevisionCounter, runId: this.mapRunId, evidence: this.mapEvidence,
      locations: [...this.locations.values()],
    });
  }

  /**
   * Replaces locations for the devices this run targeted and leaves everyone else alone. A target
   * the decoder could not place becomes `unseen`: an unknown position is a real answer and must
   * never be rounded to a point on the map.
   */
  commitMap(input: {
    runId: string;
    runTag: number;
    evidence: AudienceMapData["evidence"];
    locations: LocationData[];
    targets: number[];
  }): number {
    const decoded = new Map(input.locations.map(location => [location.deviceId, location]));
    for (const deviceId of input.targets) {
      this.locations.set(deviceId, decoded.get(deviceId) ?? defaultLocation(deviceId));
    }
    this.mapRevisionCounter++;
    this.mapRunId = input.runId;
    this.mapEvidence = input.evidence;
    this.committedRunTag = input.runTag;
    this.revisionCounter++;
    return this.mapRevisionCounter;
  }

  restoreMap(map: AudienceMapData, committedRunTag: number | null): void {
    this.mapRevisionCounter = map.mapRevision;
    this.mapRunId = map.runId;
    this.mapEvidence = map.evidence;
    this.committedRunTag = committedRunTag;
    for (const location of map.locations) this.locations.set(location.deviceId, location);
  }

  // Only connected phones are expected to answer a preparation. An operator console is not a
  // device and is never counted as one.
  connectedDeviceIds(): number[] {
    return [...this.readiness.values()].filter(device => device.connected).map(device => device.deviceId);
  }
  playbackDeviceIds(): number[] {
    return this.connectedDeviceIds().filter(id => this.transportRecipients.get(this.transportState.transportRevision)?.has(id) ?? true);
  }

  private base(clock: ServerClock) {
    return {
      protocolVersion: PROTOCOL_VERSION, sessionId: clock.sessionId, serverEpoch: clock.serverEpoch,
      revision: this.revisionCounter, serverMs: clock.nowServerMs(),
      show: this.show, transport: this.transportState, pendingActions: this.pendingActions,
      mix: { mixRevision: this.effectiveMixRevision, masterGain: this.masterGainState },
    };
  }

  participantSnapshot(deviceId: number, clock: ServerClock): ParticipantSnapshotData | null {
    this.applyDue(clock.nowServerMs());
    const readiness = this.readiness.get(deviceId);
    const assignment = this.assignments.get(deviceId);
    const location = this.locations.get(deviceId);
    if (!readiness || !assignment || !location) return null;
    const pendingActions = this.pendingActions.flatMap<PendingActionData>(action => {
      if (action.domain === "transport" && action.transport.status === "playing" && this.transportRecipients.has(action.transport.transportRevision)
        && !this.transportRecipients.get(action.transport.transportRevision)!.has(deviceId)) return [];
      if (action.domain !== "assignment") return [action];
      const assignments = action.assignments.filter(item => item.deviceId === deviceId);
      return assignments.length ? [{ ...action, assignments }] : [];
    });
    const excluded = this.transportState.status === "playing" && this.transportRecipients.has(this.transportState.transportRevision)
      && !this.transportRecipients.get(this.transportState.transportRevision)!.has(deviceId);
    return ParticipantSnapshot.parse({ ...this.base(clock), transport: excluded ? stoppedTransport(this.transportState.transportRevision, this.showRevision) : this.transportState,
      pendingActions, role: "participant", deviceId, readiness, assignment, location });
  }

  adminSnapshot(clock: ServerClock): AdminSnapshotData {
    this.applyDue(clock.nowServerMs());
    return AdminSnapshot.parse({
      ...this.base(clock), role: "admin",
      audienceMap: this.audienceMap,
      devices: [...this.readiness.values()],
      assignments: [...this.assignments.values()],
      assignmentRevision: this.assignmentRevisionCounter,
      appliedCommandIds: [...this.appliedCommands], ...this.adminContext(),
    });
  }
}
