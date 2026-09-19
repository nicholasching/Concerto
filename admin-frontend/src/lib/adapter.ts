import {
  AdminSnapshot, CalibrationCreated, CalibrationResource, CameraUploadReceipt, CommandAccepted,
  JobProgress, JobResource, Track, type AdminSnapshotData, type ShowData,
} from "@orchestra/contracts";

export type Column = "left" | "center" | "right";
export class AdapterError extends Error {
  constructor(public code: string, message: string, public retryable: boolean, public status: number) { super(message); }
}
export interface PendingCommand {
  commandId: string; domain: "assignment" | "transport" | "mix" | "calibration" | "panic" | "show";
  status: "pending" | "accepted" | "scheduled" | "effective" | "cancelled" | "error" | "obsolete";
  error?: string; sentAt: number; sentRevision: number; effectiveServerMs?: number;
}
export interface AssignmentArgs { deviceIds: number[]; channelId: string | null; mapRevision: number; effectiveServerMs: number }
export interface TransportArgs { action: "prepare" | "play" | "pause" | "seek" | "stop"; showRevision: number; positionMs: number; effectiveServerMs: number }
export interface MixArgs { masterGain: number; channels: ShowData["channels"]; effectiveServerMs: number }
export interface Geometry { rotationDegrees: 0 | 90 | 180 | 270; anchors: { x: number; y: number }[] | null; exclusionRois: { x: number; y: number }[][] }
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createAdapter(baseUrl: string, fetcher: Fetcher = fetch) {
  let session = { sessionId: "dev-session", serverEpoch: "", revision: 0 };
  let secret = "";
  let newestSnapshot: AdminSnapshotData | null = null;
  let requestSequence = 0, acceptedSequence = 0;
  const pending = new Map<string, PendingCommand>();
  const id = () => crypto.randomUUID();
  const headers = () => ({ "x-operator-secret": secret });

  async function safeFetch(path: string, init: RequestInit = {}): Promise<Response> {
    try { return await fetcher(`${baseUrl}${path}`, { ...init, headers: { ...headers(), ...init.headers } }); }
    catch { throw new AdapterError("SERVER_UNREACHABLE", `Real server not detected at ${baseUrl}`, false, 0); }
  }
  async function check(response: Response): Promise<Response> {
    if (response.ok) return response;
    const body = await response.json().catch(() => null);
    throw new AdapterError(body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? `HTTP ${response.status}`, body?.error?.retryable ?? false, response.status);
  }
  function revision(domain: PendingCommand["domain"]): number {
    const snapshot = newestSnapshot;
    if (!snapshot) return 0;
    if (domain === "assignment") return snapshot.assignmentRevision;
    if (domain === "mix") return Math.max(snapshot.mix.mixRevision, ...snapshot.pendingActions.filter(action => action.domain === "mix").map(action => action.mixRevision));
    if (domain === "show") return snapshot.show.showRevision;
    if (domain === "transport") return Math.max(snapshot.transport.transportRevision, ...snapshot.pendingActions.filter(action => action.domain === "transport").map(action => action.transport.transportRevision));
    return snapshot.revision;
  }
  function context(commandId: string, domain: PendingCommand["domain"]) {
    return { protocolVersion: 1, sessionId: session.sessionId, serverEpoch: session.serverEpoch, commandId, expectedRevision: revision(domain) };
  }
  async function submit<T>(path: string, args: object, domain: PendingCommand["domain"], parse: (value: unknown) => T, method = "POST"): Promise<T> {
    const commandId = id(), body = { ...context(commandId, domain), ...args };
    const cmd: PendingCommand = { commandId, domain, status: "pending", sentAt: Date.now(), sentRevision: revision(domain),
      effectiveServerMs: "effectiveServerMs" in args ? Number(args.effectiveServerMs) : undefined };
    pending.set(commandId, cmd);
    try {
      const response = await check(await safeFetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      const result = parse(await response.json());
      if (session.serverEpoch !== body.serverEpoch) throw new AdapterError("STALE_EPOCH", "The server restarted during this command.", true, 409);
      if (result && typeof result === "object" && "commandId" in result) {
        const ack = CommandAccepted.parse(result);
        if (ack.commandId !== commandId || ack.sessionId !== body.sessionId || ack.serverEpoch !== body.serverEpoch) {
          throw new AdapterError("ACK_MISMATCH", "The response belongs to a different command or session.", false, 409);
        }
      }
      cmd.status = domain === "panic" || domain === "show" ? "effective" : "accepted";
      return result;
    } catch (cause) { cmd.status = "error"; cmd.error = cause instanceof Error ? cause.message : String(cause); throw cause; }
  }
  async function getSnapshot(): Promise<AdminSnapshotData> {
    const sequence = ++requestSequence;
    const data = AdminSnapshot.parse(await (await check(await safeFetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/snapshot`))).json());
    if (newestSnapshot && (sequence < acceptedSequence || (data.serverEpoch === newestSnapshot.serverEpoch && data.revision < newestSnapshot.revision))) return newestSnapshot;
    if (session.serverEpoch && session.serverEpoch !== data.serverEpoch) {
      for (const command of pending.values()) if (!["effective", "error"].includes(command.status)) command.status = "obsolete";
    }
    acceptedSequence = sequence; newestSnapshot = data;
    session = { sessionId: data.sessionId, serverEpoch: data.serverEpoch, revision: data.revision };
    for (const cmd of pending.values()) {
      if (["error", "obsolete", "effective", "cancelled"].includes(cmd.status)) continue;
      if (data.appliedCommandIds.includes(cmd.commandId)) cmd.status = "effective";
      else if (data.pendingActions.some(action => action.commandId === cmd.commandId)) cmd.status = "scheduled";
      else if (cmd.status === "scheduled") cmd.status = "cancelled";
    }
    return data;
  }
  async function upload(path: string, metadata: Record<string, string | number>, file: File, progress?: (fraction: number) => void): Promise<unknown> {
    const query = new URLSearchParams(Object.entries({ ...metadata, commandId: id(), byteSize: file.size, label: file.name }).map(([key, value]) => [key, String(value)]));
    if (typeof XMLHttpRequest !== "undefined" && progress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhr.open("POST", `${baseUrl}${path}?${query}`);
        xhr.setRequestHeader("x-operator-secret", secret);
        xhr.upload.onprogress = event => { if (event.lengthComputable) progress(event.loaded / event.total); };
        xhr.onerror = () => reject(new AdapterError("UPLOAD_FAILED", "Upload interrupted. Retry this camera.", true, 0));
        xhr.onload = () => {
          try { const data = JSON.parse(xhr.responseText); if (xhr.status >= 400) reject(new AdapterError(data.error?.code ?? "UPLOAD_FAILED", data.error?.message ?? "Upload failed", true, xhr.status)); else resolve(data); }
          catch (cause) { reject(cause); }
        };
        xhr.send(file);
      });
    }
    return (await check(await safeFetch(`${path}?${query}`, { method: "POST", body: file }))).json();
  }

  return {
    configure(operatorSecret: string, sessionId = "dev-session") { secret = operatorSecret; session = { sessionId, serverEpoch: "", revision: 0 }; newestSnapshot = null; },
    async discoverSession() { return (await check(await safeFetch("/api/session"))).json() as Promise<{ sessionId: string; serverEpoch: string }>; },
    socketUrl() { const url = new URL(`${baseUrl.replace(/^http/, "ws")}/ws`); url.searchParams.set("operatorSecret", secret); return url.toString(); },
    pending: () => [...pending.values()], pendingById: (key: string) => pending.get(key), clearPending: () => pending.clear(), getSnapshot,
    async createCalibration(participantIds: number[], palette: { zero: string; one: string; neutral: string }, paletteVersion: string) {
      return submit("/api/calibrations", { participantIds, palette, paletteVersion }, "calibration", value => CalibrationCreated.parse(value));
    },
    async armCalibration(runId: string, preparationId: string, effectiveServerMs: number) {
      return submit(`/api/calibrations/${runId}/arm`, { runId, preparationId, effectiveServerMs }, "calibration", value => CommandAccepted.parse(value));
    },
    async getCalibration(runId: string) { return CalibrationResource.parse(await (await check(await safeFetch(`/api/calibrations/${runId}`))).json()); },
    async discardCalibration(runId: string) { await check(await safeFetch(`/api/calibrations/${runId}`, { method: "DELETE" })); },
    async uploadCamera(runId: string, cameraId: string, primaryColumn: Column, file: File | null, geometry: Geometry = { rotationDegrees: 0, anchors: null, exclusionRois: [] }, progress?: (fraction: number) => void) {
      if (!file) throw new Error("Choose the original camera recording first.");
      return CameraUploadReceipt.parse(await upload(`/api/calibrations/${runId}/uploads`, { cameraId, primaryColumn, rotationDegrees: geometry.rotationDegrees,
        ...(geometry.anchors ? { anchors: JSON.stringify(geometry.anchors) } : {}), exclusionRois: JSON.stringify(geometry.exclusionRois) }, file, progress));
    },
    async createJob(runId: string, uploadIds: string[], evidence: "physical" | "synthetic" = "physical") {
      return submit(`/api/calibrations/${runId}/jobs`, { runId, uploadIds, evidence }, "calibration", value => JobProgress.parse(value));
    },
    async updateCamera(runId: string, uploadId: string, primaryColumn: Column, geometry: Geometry) {
      return CameraUploadReceipt.parse(await (await check(await safeFetch(`/api/calibrations/${runId}/uploads/${uploadId}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ primaryColumn, ...geometry }),
      }))).json());
    },
    async getJobProgress(jobId: string) { return JobResource.parse(await (await check(await safeFetch(`/api/jobs/${jobId}`))).json()); },
    async cancelJob(jobId: string) { await check(await safeFetch(`/api/jobs/${jobId}`, { method: "DELETE" })); },
    async preview(jobId: string, cameraIndex: number) { return (await check(await safeFetch(`/api/jobs/${jobId}/debug/camera-${cameraIndex}.png`))).blob(); },
    async commitMap(runId: string, jobId: string, expectedMapRevision: number) {
      return submit(`/api/calibrations/${runId}/commit-map`, { runId, jobId, expectedMapRevision }, "calibration", value => CommandAccepted.parse(value));
    },
    async sendAssignment(args: AssignmentArgs) {
      const started = performance.now();
      const live = newestSnapshot?.transport.status === "playing" || newestSnapshot?.pendingActions.some(action => action.domain === "transport" && action.transport.status === "playing");
      if (!live || args.channelId === null) return submit("/api/assignments", args, "assignment", value => CommandAccepted.parse(value));
      const prepared = await submit("/api/assignments/prepare", args, "assignment", value => CommandAccepted.parse(value));
      const preparationId = prepared.preparationId;
      if (!preparationId) throw new Error("The server did not create an assignment preparation.");
      const assignmentRevision = revision("assignment");
      do {
        const snapshot = await getSnapshot();
        if (revision("assignment") !== assignmentRevision) throw new Error("Assignments changed while preparing. Select and assign again.");
        const barrier = snapshot.preparations.find(item => item.preparationId === preparationId);
        if (!barrier) throw new Error("The assignment preparation was superseded. Try again.");
        if (barrier.readyIds.length + barrier.excluded.length === barrier.expectedIds.length) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (performance.now() - started < 1500);
      return submit("/api/assignments", { ...args, preparationId, effectiveServerMs: args.effectiveServerMs + performance.now() - started }, "assignment", value => CommandAccepted.parse(value));
    },
    async sendTransport(args: TransportArgs) { return submit("/api/transport", args, "transport", value => CommandAccepted.parse(value)); },
    async sendMix(args: MixArgs) { return submit("/api/mix", args, "mix", value => CommandAccepted.parse(value)); },
    async panic() { return submit("/api/panic", {}, "panic", value => CommandAccepted.parse(value)); },
    async saveShow(show: ShowData) { return submit("/api/show", { show }, "show", value => CommandAccepted.parse(value), "PUT"); },
    async uploadAudio(file: File, metadata: { durationMs: number; sampleRateHz: number; channels: number }) {
      return Track.parse(await upload("/api/assets", metadata, file));
    },
  };
}

export { AssignmentRequest, TransportRequest, MixRequest, PanicRequest, CalibrationCreateRequest, CalibrationArmRequest, CommitMapRequest, CreateJobRequest } from "@orchestra/contracts";
