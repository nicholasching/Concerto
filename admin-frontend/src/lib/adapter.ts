// Typed adapter: the only module in the admin console that talks to the server. Every screen asks
// the adapter for data and sends commands through it. The rest of the console does not know
// whether it is talking to the fake-input harness or the real server. Two rules are enforced here:
// (a) server errors surface honestly as AdapterError, never swallowed into fake success; and
// (b) pending (sent, not yet confirmed) is tracked separately from confirmed state, so the UI can
// never show a local change as success before the server confirms it.

import {
  AdminSnapshot, AssignmentRequest, CalibrationArmRequest, CalibrationCreateRequest, CommandAccepted,
  CommitMapRequest, CreateJobRequest, MixRequest, PanicRequest, TransportRequest,
  type AdminSnapshotData,
} from "@orchestra/contracts";

export type Column = "left" | "center" | "right";

export class AdapterError extends Error {
  constructor(public code: string, message: string, public retryable: boolean, public status: number) { super(message); }
}

export interface PendingCommand {
  commandId: string;
  domain: "assignment" | "transport" | "mix" | "calibration" | "panic";
  status: "pending" | "accepted" | "scheduled" | "effective" | "error" | "obsolete";
  error?: string;
  sentAt: number;
  sentRevision: number;
}

export interface AssignmentArgs { deviceIds: number[]; channelId: string | null; mapRevision: number; effectiveServerMs: number; }
export interface TransportArgs { action: "prepare" | "play" | "pause" | "seek" | "stop"; showRevision: number; positionMs: number; effectiveServerMs: number; }
export interface MixArgs { masterGain: number; channels: AdminSnapshotData["show"]["channels"]; effectiveServerMs: number; }

const PROTOCOL_VERSION = 1 as const;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createAdapter(baseUrl: string, fetcher: Fetcher = fetch) {
  let session = { sessionId: "demo", serverEpoch: "", revision: 0 };
  const pending = new Map<string, PendingCommand>();
  let newestRequest = 0;
  let newestAcceptedRequest = 0;
  let newestSnapshot: AdminSnapshotData | null = null;

  function newCommandId() { return `cmd-${Math.random().toString(36).slice(2, 12)}`; }

  // Every network call goes through safeFetch so a missing/unreachable server becomes one clean
  // error instead of a raw TypeError. This is the "not detected" path: the console tries the real
  // server, and if nothing is listening it reports that honestly rather than faking success.
  async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
    try { return await fetcher(url, init); }
    catch { throw new AdapterError("SERVER_UNREACHABLE", `Real server not detected at ${baseUrl}`, false, 0); }
  }

  async function parseError(response: Response): Promise<never> {
    let code = "HTTP_ERROR", message = `HTTP ${response.status}`, retryable = false;
    try {
      const body = await response.json();
      if (body?.error) { code = body.error.code ?? code; message = body.error.message ?? message; retryable = body.error.retryable ?? retryable; }
    } catch { /* keep defaults */ }
    throw new AdapterError(code, message, retryable, response.status);
  }

  async function getSnapshot(): Promise<AdminSnapshotData> {
    const requestId = ++newestRequest;
    const response = await safeFetch(`${baseUrl}/api/sessions/demo/snapshot`);
    if (!response.ok) await parseError(response);
    const data = AdminSnapshot.parse(await response.json());
    // A late HTTP response must never roll the console back across a newer snapshot/epoch.
    if (requestId < newestAcceptedRequest && newestSnapshot) return newestSnapshot;
    if (newestSnapshot && data.serverEpoch === newestSnapshot.serverEpoch && data.revision < newestSnapshot.revision) return newestSnapshot;
    if (session.serverEpoch && data.serverEpoch !== session.serverEpoch) {
      for (const command of pending.values()) if (command.status !== "effective" && command.status !== "error") command.status = "obsolete";
    }
    newestAcceptedRequest = requestId;
    newestSnapshot = data;
    session = { sessionId: data.sessionId, serverEpoch: data.serverEpoch, revision: data.revision };
    // A revision is global, so it cannot confirm a particular command. Only the command's own
    // pending action can establish scheduling; its later disappearance establishes effectiveness.
    for (const [, cmd] of pending) {
      if (cmd.status === "pending" || cmd.status === "accepted" || cmd.status === "scheduled") {
        if (data.pendingActions.some(action => action.commandId === cmd.commandId)) cmd.status = "scheduled";
        else if (cmd.status === "scheduled") cmd.status = "effective";
      }
    }
    return data;
  }

  async function sendJson<T>(path: string, body: Record<string, unknown>, commandId: string, domain: PendingCommand["domain"], sentRevision: number, validateAccepted = true): Promise<T> {
    const cmd: PendingCommand = { commandId, domain, status: "pending", sentAt: Date.now(), sentRevision };
    pending.set(commandId, cmd);
    try {
      const response = await safeFetch(`${baseUrl}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) { cmd.status = "error"; await parseError(response); }
      const result = await response.json();
      if (validateAccepted) CommandAccepted.parse(result);
      cmd.status = "accepted";
      return result as T;
    } catch (error) {
      cmd.status = "error";
      cmd.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  function context(commandId: string) {
    return { protocolVersion: PROTOCOL_VERSION, sessionId: session.sessionId, serverEpoch: session.serverEpoch, commandId, expectedRevision: session.revision };
  }

  return {
    pending: () => Array.from(pending.values()),
    pendingById: (id: string) => pending.get(id),
    clearPending: () => pending.clear(),

    getSnapshot,

    async createCalibration(participantIds: number[], palette: { zero: string; one: string; neutral: string }, paletteVersion: string) {
      const commandId = newCommandId();
      return sendJson<{ runId: string; runTag: number; revision: number }>("/api/calibrations", { ...context(commandId), participantIds, palette, paletteVersion }, commandId, "calibration", session.revision, false);
    },
    async armCalibration(runId: string, preparationId: string, effectiveServerMs: number) {
      const commandId = newCommandId();
      return sendJson<{ runId: string; startServerMs: number; revision: number }>(`/api/calibrations/${runId}/arm`, { ...context(commandId), runId, preparationId, effectiveServerMs }, commandId, "calibration", session.revision);
    },
    async uploadCamera(runId: string, cameraId: string, primaryColumn: Column, file: File | null) {
      const form = new FormData();
      form.set("cameraId", cameraId);
      form.set("primaryColumn", primaryColumn);
      if (file) form.set("file", file);
      const response = await safeFetch(`${baseUrl}/api/calibrations/${runId}/uploads`, { method: "POST", body: form });
      if (!response.ok) await parseError(response);
      return response.json() as Promise<{ uploadId: string; cameraId: string; revision: number }>;
    },
    async createJob(runId: string, uploadIds: string[]) {
      const commandId = newCommandId();
      return sendJson<{ jobId: string; revision: number }>(`/api/calibrations/${runId}/jobs`, { ...context(commandId), runId, uploadIds }, commandId, "calibration", session.revision, false);
    },
    async getJobProgress(jobId: string) {
      const response = await safeFetch(`${baseUrl}/api/jobs/${jobId}`);
      if (!response.ok) await parseError(response);
      return response.json() as Promise<{ protocolVersion: 1; jobId: string; runId: string; stage: string; progress: number; message: string }>;
    },
    async commitMap(runId: string, jobId: string, expectedMapRevision: number) {
      const commandId = newCommandId();
      return sendJson<{ mapRevision: number; revision: number }>(`/api/calibrations/${runId}/commit-map`, { ...context(commandId), runId, jobId, expectedMapRevision }, commandId, "calibration", session.revision);
    },

    async sendAssignment(args: AssignmentArgs) {
      const commandId = newCommandId();
      return sendJson<{ commandId: string; revision: number }>("/api/assignments", { ...context(commandId), ...args }, commandId, "assignment", session.revision);
    },
    async sendTransport(args: TransportArgs) {
      const commandId = newCommandId();
      return sendJson<{ commandId: string; revision: number }>("/api/transport", { ...context(commandId), ...args }, commandId, "transport", session.revision);
    },
    async sendMix(args: MixArgs) {
      const commandId = newCommandId();
      return sendJson<{ commandId: string; revision: number }>("/api/mix", { ...context(commandId), ...args }, commandId, "mix", session.revision);
    },
    async panic() {
      const commandId = newCommandId();
      return sendJson<{ commandId: string; revision: number }>("/api/panic", { ...context(commandId) }, commandId, "panic", session.revision);
    },
  };
}

// Re-export the request schemas for callers that want to validate locally before sending.
export { AssignmentRequest, TransportRequest, MixRequest, PanicRequest, CalibrationCreateRequest, CalibrationArmRequest, CommitMapRequest, CreateJobRequest };
