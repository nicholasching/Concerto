// Admin fake-input harness factory. In-memory deterministic state for the admin console, built on
// plain Bun.serve (no extra dependencies). No real server, cameras, phones, audio, or video. All
// maps are labeled synthetic. See README.md. Exported so adapter tests can start a small instance.

import { z } from "zod";
import {
  AdminSnapshot, AssignmentRequest, CalibrationArmRequest, CalibrationCreateRequest,
  CommitMapRequest, CreateJobRequest, JobProgress, MixRequest, PanicRequest, PendingAction, TransportRequest,
  type AdminSnapshotData,
} from "@orchestra/contracts";
import { createDemoSnapshot } from "@orchestra/testkit";

type PendingActionData = z.infer<typeof PendingAction>;
type TransportData = AdminSnapshotData["transport"];

// Monotonic-backed epoch clock, same definition as packages/sync epochNow(). Inlined here so the
// harness has no dependency on @orchestra/sync (tools is not a workspace package with its own
// manifest). The console itself uses the shared @orchestra/sync clock.
const epochNow = () => performance.timeOrigin + performance.now();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "X-Orchestra-Mock": "1",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } });
}
function apiError(code: string, message: string, retryable: boolean, status: number) {
  return json({ protocolVersion: 1, error: { code, message, retryable } }, status);
}

export function startAdminHarness(port = 18084, count = 1500) {
  const base = createDemoSnapshot(count);
  const snapshot: AdminSnapshotData = {
    ...base,
    sessionId: "demo",
    serverEpoch: crypto.randomUUID(),
    revision: 1,
    serverMs: epochNow(),
    transport: { status: "stopped", transportRevision: 0, showRevision: base.show.showRevision, positionMs: 0, startServerMs: null },
    pendingActions: [],
  };

  interface RunState { runId: string; runTag: number; status: "created" | "armed" | "committed"; startServerMs: number | null; uploads: string[]; }
  const runs = new Map<string, RunState>();
  interface JobState { jobId: string; runId: string; stage: z.infer<typeof JobProgress>["stage"]; progress: number; message: string; candidateLocations: AdminSnapshotData["audienceMap"]["locations"] | null; }
  const jobs = new Map<string, JobState>();
  const timers = new Set<ReturnType<typeof setInterval>>();

  function newId(prefix: string) { return `${prefix}-${Math.random().toString(36).slice(2, 10)}`; }

  function applyDuePendingActions() {
    const now = snapshot.serverMs;
    const remaining: PendingActionData[] = [];
    for (const action of snapshot.pendingActions) {
      if (action.effectiveServerMs > now) { remaining.push(action); continue; }
      if (action.domain === "transport") snapshot.transport = action.transport;
      else if (action.domain === "assignment") {
        for (const a of action.assignments) {
          const idx = snapshot.assignments.findIndex(x => x.deviceId === a.deviceId);
          const updated = { ...a, assignmentRevision: snapshot.revision + 1, mapRevision: a.mapRevision };
          if (idx >= 0) snapshot.assignments[idx] = updated; else snapshot.assignments.push(updated);
        }
      } else if (action.domain === "mix") {
        snapshot.show = { ...snapshot.show, channels: action.channels };
      }
      snapshot.revision += 1;
    }
    snapshot.pendingActions = remaining;
  }
  function refreshServerMs() { snapshot.serverMs = epochNow(); applyDuePendingActions(); }

  async function body<T>(request: Request, schema: { parse: (v: unknown) => T }): Promise<T> {
    try { return schema.parse(await request.json()); }
    catch { throw new HttpError(400, "INVALID_MESSAGE", "Request body failed schema validation", false); }
  }
  class HttpError extends Error { constructor(public status: number, public code: string, message: string, public retryable: boolean) { super(message); } }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (path === "/api/health" && request.method === "GET") return json({ implementation: "admin-harness", synthetic: true });

    if (path === "/api/sessions/demo/snapshot" && request.method === "GET") { refreshServerMs(); return json(AdminSnapshot.parse(snapshot)); }
    if (path === "/__mock__/state" && request.method === "GET") { refreshServerMs(); return json(snapshot); }

    // Calibration
    if (path === "/api/calibrations" && request.method === "POST") {
      const b = await body(request, CalibrationCreateRequest);
      const runId = newId("run"); const runTag = runs.size % 256;
      runs.set(runId, { runId, runTag, status: "created", startServerMs: null, uploads: [] });
      snapshot.revision += 1;
      return json({ runId, runTag, revision: snapshot.revision, commandId: b.commandId });
    }
    const armMatch = path.match(/^\/api\/calibrations\/([^/]+)\/arm$/);
    if (armMatch && request.method === "POST") {
      const run = runs.get(armMatch[1]);
      if (!run) return apiError("RUN_NOT_FOUND", "Unknown calibration run", false, 404);
      const b = await body(request, CalibrationArmRequest);
      run.status = "armed"; run.startServerMs = b.effectiveServerMs;
      snapshot.revision += 1;
      return json({ runId: run.runId, startServerMs: run.startServerMs, revision: snapshot.revision, commandId: b.commandId });
    }
    const uploadMatch = path.match(/^\/api\/calibrations\/([^/]+)\/uploads$/);
    if (uploadMatch && request.method === "POST") {
      const run = runs.get(uploadMatch[1]);
      if (!run) return apiError("RUN_NOT_FOUND", "Unknown calibration run", false, 404);
      const form = await request.formData();
      const cameraId = String(form.get("cameraId") ?? newId("cam"));
      const uploadId = newId("up");
      run.uploads.push(uploadId);
      snapshot.revision += 1;
      return json({ uploadId, cameraId, revision: snapshot.revision });
    }
    const jobMatch = path.match(/^\/api\/calibrations\/([^/]+)\/jobs$/);
    if (jobMatch && request.method === "POST") {
      const run = runs.get(jobMatch[1]);
      if (!run) return apiError("RUN_NOT_FOUND", "Unknown calibration run", false, 404);
      const b = await body(request, CreateJobRequest);
      const jobId = newId("job");
      const candidate = snapshot.audienceMap.locations.map(loc =>
        loc.status === "localized"
          ? { ...loc, x: Math.min(1, Math.max(0, loc.x! + (Math.random() - 0.5) * 0.02)), y: Math.min(1, Math.max(0, loc.y! + (Math.random() - 0.5) * 0.02)), mappingMode: "overlap" as const }
          : loc,
      );
      jobs.set(jobId, { jobId, runId: run.runId, stage: "queued", progress: 0, message: "Queued", candidateLocations: candidate });
      snapshot.revision += 1;
      const stages: z.infer<typeof JobProgress>["stage"][] = ["validate", "decode", "track", "register", "complete"];
      let step = 0;
      const tick = setInterval(() => {
        const job = jobs.get(jobId); if (!job) { clearInterval(tick); return; }
        step += 1;
        job.progress = Math.min(1, step / stages.length);
        job.stage = stages[Math.min(step, stages.length - 1)];
        job.message = job.stage === "complete" ? "Complete" : `Processing ${job.stage}`;
        if (job.stage === "complete") clearInterval(tick);
      }, 400);
      timers.add(tick);
      return json({ jobId, revision: snapshot.revision, commandId: b.commandId });
    }
    const jobGet = path.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobGet && request.method === "GET") {
      const job = jobs.get(jobGet[1]);
      if (!job) return apiError("JOB_NOT_FOUND", "Unknown job", false, 404);
      return json(JobProgress.parse({ protocolVersion: 1, jobId: job.jobId, runId: job.runId, stage: job.stage, progress: job.progress, message: job.message }));
    }
    const commitMatch = path.match(/^\/api\/calibrations\/([^/]+)\/commit-map$/);
    if (commitMatch && request.method === "POST") {
      const run = runs.get(commitMatch[1]);
      if (!run) return apiError("RUN_NOT_FOUND", "Unknown run", false, 404);
      const b = await body(request, CommitMapRequest);
      let candidate: AdminSnapshotData["audienceMap"]["locations"] | null = null;
      for (const job of jobs.values()) if (job.runId === run.runId && job.candidateLocations) candidate = job.candidateLocations;
      if (!candidate) return apiError("NO_RESULT", "No completed job result to commit", false, 409);
      if (b.expectedMapRevision !== snapshot.audienceMap.mapRevision) return apiError("STALE_MAP", "Map revision is stale; refresh and reselect", false, 409);
      snapshot.audienceMap = { ...snapshot.audienceMap, mapRevision: snapshot.audienceMap.mapRevision + 1, runId: run.runId, locations: candidate };
      run.status = "committed";
      snapshot.revision += 1;
      return json({ mapRevision: snapshot.audienceMap.mapRevision, revision: snapshot.revision, commandId: b.commandId });
    }

    // Assignment / transport / mix / panic
    if (path === "/api/assignments" && request.method === "POST") {
      const b = await body(request, AssignmentRequest);
      if (b.mapRevision !== snapshot.audienceMap.mapRevision) return apiError("STALE_MAP", "Map changed; refresh and reselect", false, 409);
      const assignments = b.deviceIds.map(deviceId => ({ deviceId, channelId: b.channelId, assignmentRevision: snapshot.revision + 1, mapRevision: b.mapRevision }));
      snapshot.pendingActions.push({ commandId: b.commandId, domain: "assignment", effectiveServerMs: b.effectiveServerMs, supersedesCommandId: null, assignments });
      snapshot.revision += 1;
      return json({ commandId: b.commandId, revision: snapshot.revision });
    }
    if (path === "/api/transport" && request.method === "POST") {
      const b = await body(request, TransportRequest);
      const transport: TransportData = b.action === "stop"
        ? { status: "stopped", transportRevision: snapshot.transport.transportRevision + 1, showRevision: b.showRevision, positionMs: 0, startServerMs: null }
        : b.action === "pause"
        ? { status: "paused", transportRevision: snapshot.transport.transportRevision + 1, showRevision: b.showRevision, positionMs: b.positionMs, startServerMs: null }
        : { status: "playing", transportRevision: snapshot.transport.transportRevision + 1, showRevision: b.showRevision, positionMs: b.positionMs, startServerMs: b.effectiveServerMs };
      snapshot.pendingActions.push({ commandId: b.commandId, domain: "transport", effectiveServerMs: b.effectiveServerMs, supersedesCommandId: null, transport });
      snapshot.revision += 1;
      return json({ commandId: b.commandId, revision: snapshot.revision });
    }
    if (path === "/api/mix" && request.method === "POST") {
      const b = await body(request, MixRequest);
      snapshot.pendingActions.push({ commandId: b.commandId, domain: "mix", effectiveServerMs: b.effectiveServerMs, supersedesCommandId: null, mixRevision: snapshot.revision + 1, masterGain: b.masterGain, channels: b.channels });
      snapshot.revision += 1;
      return json({ commandId: b.commandId, revision: snapshot.revision });
    }
    if (path === "/api/panic" && request.method === "POST") {
      const b = await body(request, PanicRequest);
      snapshot.pendingActions = [];
      const stopped: TransportData = { status: "stopped", transportRevision: snapshot.transport.transportRevision + 1, showRevision: snapshot.transport.showRevision, positionMs: 0, startServerMs: null };
      snapshot.transport = stopped;
      snapshot.show = { ...snapshot.show, channels: snapshot.show.channels.map(ch => ({ ...ch, mute: true })) };
      snapshot.revision += 1;
      return json({ commandId: b.commandId, revision: snapshot.revision });
    }

    if (path.startsWith("/api/")) return apiError("MOCK_NOT_IMPLEMENTED", "Admin harness does not implement this route.", false, 501);
    return new Response("Not found", { status: 404, headers: CORS });
  }

  const server = Bun.serve({
    hostname: "127.0.0.1", port,
    async fetch(request) {
      try { return await route(request); }
      catch (error) {
        if (error instanceof HttpError) return apiError(error.code, error.message, error.retryable, error.status);
        return apiError("INTERNAL", String(error), false, 500);
      }
    },
  });
  return { url: server.url, stop: () => { for (const t of timers) clearInterval(t); server.stop(true); } };
}
