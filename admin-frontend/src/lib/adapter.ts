// Typed adapter: the only module in the admin console that talks to the server. Every screen asks
// the adapter for data and sends commands through it. The rest of the console does not know
// whether it is talking to the fake-input harness or the real server. Two rules are enforced here:
// (a) server errors surface honestly as AdapterError, never swallowed into fake success; and
// (b) pending (sent, not yet confirmed) is tracked separately from confirmed state, so the UI can
// never show a local change as success before the server confirms it.

import {
  AdminSnapshot, AssignmentRequest, CalibrationArmRequest, CalibrationCreateRequest,
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
  status: "pending" | "confirmed" | "error";
  error?: string;
  sentAt: number;
  sentRevision: number;
}

export interface AssignmentArgs { deviceIds: number[]; channelId: string | null; mapRevision: number; effectiveServerMs: number; }
export interface TransportArgs { action: "prepare" | "play" | "pause" | "seek" | "stop"; showRevision: number; positionMs: number; effectiveServerMs: number; }
export interface MixArgs { masterGain: number; channels: AdminSnapshotData["show"]["channels"]; effectiveServerMs: number; }

const PROTOCOL_VERSION = 1 as const;

export function createAdapter(baseUrl: string) {
  let session = { sessionId: "demo", serverEpoch: "", revision: 0 };
  const pending = new Map<string, PendingCommand>();

  function newCommandId() { return `cmd-${Math.random().toString(36).slice(2, 12)}`; }

  async function parseError(response: Response): Promise<never> {
    let code = "HTTP_ERROR", message = `HTTP ${response.status}`, retryable = false;
    try {
      const body = await response.json();
      if (body?.error) { code = body.error.code ?? code; message = body.error.message ?? message; retryable = body.error.retryable ?? retryable; }
    } catch { /* keep defaults */ }
    throw new AdapterError(code, message, retryable, response.status);
  }

  async function getSnapshot(): Promise<AdminSnapshotData> {
    const response = await fetch(`${baseUrl}/api/sessions/demo/snapshot`);
    if (!response.ok) await parseError(response);
    const data = AdminSnapshot.parse(await response.json());
    session = { sessionId: data.sessionId, serverEpoch: data.serverEpoch, revision: data.revision };
    // Any pending commands whose effect is now reflected in the confirmed snapshot are confirmed.
    for (const [, cmd] of pending) {
      if (cmd.status === "pending") {
        // Simple heuristic: a command is confirmed once the server revision advances past the
        // revision we sent it against. The harness bumps revision on accept and again on apply.
        if (data.revision > cmd.sentRevision) { cmd.status = "confirmed"; }
      }
    }
    return data;
  }

  async function sendJson<T>(path: string, body: Record<string, unknown>, commandId: string, domain: PendingCommand["domain"], sentRevision: number): Promise<T> {
    const cmd: PendingCommand = { commandId, domain, status: "pending", sentAt: Date.now(), sentRevision };
    pending.set(commandId, cmd);
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      cmd.status = "error";
      await parseError(response);
    }
    return response.json() as Promise<T>;
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
      return sendJson<{ runId: string; runTag: number; revision: number }>("/api/calibrations", { ...context(commandId), participantIds, palette, paletteVersion }, commandId, "calibration", session.revision);
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
      const response = await fetch(`${baseUrl}/api/calibrations/${runId}/uploads`, { method: "POST", body: form });
      if (!response.ok) await parseError(response);
      return response.json() as Promise<{ uploadId: string; cameraId: string; revision: number }>;
    },
    async createJob(runId: string, uploadIds: string[]) {
      const commandId = newCommandId();
      return sendJson<{ jobId: string; revision: number }>(`/api/calibrations/${runId}/jobs`, { ...context(commandId), runId, uploadIds }, commandId, "calibration", session.revision);
    },
    async getJobProgress(jobId: string) {
      const response = await fetch(`${baseUrl}/api/jobs/${jobId}`);
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
