import { calibrationDurationMs } from "@orchestra/contracts/otc";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "./app";
import { matchesOperatorSecret } from "./auth";
import { RateLimiter } from "./rate-limit";

export const CAMERA_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const columns = z.enum(["left", "center", "right"]);
const UploadInput = z.object({ runId: z.string().uuid(), column: columns, label: z.string().min(1).max(200),
  byteSize: z.number().int().positive().max(MAX_VIDEO_BYTES), rotationDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0) });
type Transfer = z.infer<typeof UploadInput> & {
  id: string; owner: string; epoch: string; expires: number; busy: boolean;
  chunks: Map<number, { id: string; sha256: string; byteSize: number }>;
  receipt?: unknown;
};
const problem = (code: string, message: string) => ({ protocolVersion: 1, error: { code, message, retryable: false, owner: "sync-control" } });

/** Stage display and camera-only API. A camera token never grants operator access. */
export function registerStageRoutes(app: Hono, deps: AppDeps, persist: () => Promise<void>) {
  const tokens = new Map<string, { epoch: string; expires: number }>();
  const transfers = new Map<string, Transfer>();
  const loginLimit = new RateLimiter(12, 0.2, deps.clock.nowServerMs);
  let cachedDisplay: { at: number; epoch: string; data: object } | null = null;
  let lastReset: { commandId: string; data: object } | null = null;
  const cameraAuthorized = (token: string | undefined): token is string => {
    if (!token) return false;
    const entry = tokens.get(token);
    return !!entry && entry.epoch === deps.clock.serverEpoch && entry.expires > deps.clock.nowServerMs();
  };
  const validRun = (runId: string) => {
    const run = deps.calibrations.get(runId);
    return run && ["armed", "processing"].includes(run.status) && run.startServerMs !== null
      && deps.clock.nowServerMs() >= run.startServerMs + calibrationDurationMs(run.plan) ? run : null;
  };
  async function prune() {
    const now = deps.clock.nowServerMs();
    for (const [key, value] of tokens) if (value.epoch !== deps.clock.serverEpoch || value.expires <= now) tokens.delete(key);
    for (const [id, transfer] of transfers) {
      if (transfer.busy || transfer.expires > now && transfer.epoch === deps.clock.serverEpoch) continue;
      transfers.delete(id);
      for (const chunk of transfer.chunks.values()) await deps.uploads.discard(chunk.id);
    }
  }

  app.get("/api/presentation", c => {
    c.header("Cache-Control", "no-store");
    const now = deps.clock.nowServerMs();
    if (!cachedDisplay || cachedDisplay.epoch !== deps.clock.serverEpoch || now - cachedDisplay.at >= 1000) {
      const snapshot = deps.state.adminSnapshot(deps.clock);
      const connected = snapshot.devices.filter(device => device.connected);
      const run = deps.calibrations.activeRun;
      const patternFinished = run?.startServerMs != null && now >= run.startServerMs + calibrationDurationMs(run.plan);
      cachedDisplay = { at: now, epoch: deps.clock.serverEpoch, data: {
        sessionId: deps.clock.sessionId, connected: connected.length,
        synced: connected.filter(device => device.clockReady).length,
        soundReady: connected.filter(device => device.audioUnlocked).length,
        assetsReady: connected.filter(device => snapshot.show.tracks.length > 0 && snapshot.show.tracks.every(track => device.decodedTrackHashes[track.trackId] === track.sha256)).length,
        mapped: snapshot.audienceMap.locations.filter(location => location.status === "localized").length,
        stage: snapshot.transport.status === "playing" ? "performing"
          : deps.state.calibrationStage === "calibrating" && patternFinished ? "processing" : deps.state.calibrationStage,
      } };
    }
    return c.json(cachedDisplay.data);
  });

  app.post("/api/reset", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) return c.json(problem("UNAUTHORIZED", "Operator access required."), 401);
    const input = z.object({ commandId: z.string().min(1), sessionId: z.string(), serverEpoch: z.string() }).safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json(problem("INVALID_REQUEST", "Reset must identify the current session."), 400);
    if (lastReset?.commandId === input.data.commandId) return c.json(lastReset.data);
    if (input.data.sessionId !== deps.clock.sessionId || input.data.serverEpoch !== deps.clock.serverEpoch) return c.json(problem("STALE_EPOCH", "Refresh before resetting this audience."), 409);
    deps.lease.suspend(deps.clock.nowServerMs());
    deps.jobs.cancelAll(); deps.calibrations.reset(); deps.preparations.reset();
    deps.connections.resetParticipants(); deps.registry.reset(); deps.state.resetAudience(); deps.commands.clear();
    deps.clock.serverEpoch = crypto.randomUUID();
    tokens.clear(); cachedDisplay = null;
    await persist();
    deps.lease.resume();
    const data = { protocolVersion: 1, sessionId: deps.clock.sessionId, serverEpoch: deps.clock.serverEpoch,
      commandId: input.data.commandId, revision: deps.state.revision };
    lastReset = { commandId: input.data.commandId, data };
    deps.connections.broadcastToOperators(JSON.stringify({ ...data, messageId: crypto.randomUUID(), type: "state.snapshot", payload: deps.state.adminSnapshot(deps.clock) }));
    await prune();
    return c.json(data);
  });

  app.post("/api/camera/login", async c => {
    if (!loginLimit.take()) return c.json(problem("RATE_LIMITED", "Wait a moment before trying again."), 429);
    const body = z.object({ password: z.string().max(200) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success || !matchesOperatorSecret(body.data.password, deps.operatorSecret)) return c.json(problem("UNAUTHORIZED", "Incorrect upload password."), 401);
    await prune();
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    tokens.set(token, { epoch: deps.clock.serverEpoch, expires: deps.clock.nowServerMs() + 2 * 60 * 60 * 1000 });
    return c.json({ token });
  });
  app.use("/api/camera/*", async (c, next) => {
    if (!cameraAuthorized(c.req.header("x-upload-token"))) return c.json(problem("UNAUTHORIZED", "Sign in to upload camera recordings."), 401);
    c.header("Cache-Control", "no-store");
    return next();
  });
  app.get("/api/camera/session", c => {
    const run = deps.calibrations.activeRun;
    return c.json({ sessionId: deps.clock.sessionId, run: run ? { runId: run.plan.runId, status: run.status,
      canUpload: !!validRun(run.plan.runId), uploads: [...run.uploads.values()].map(upload => ({ column: upload.primaryColumn, label: upload.label, byteSize: upload.byteSize })) } : null });
  });
  app.post("/api/camera/uploads", async c => {
    const input = UploadInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json(problem("INVALID_REQUEST", "Choose a video up to 1 GiB and a camera section."), 400);
    const run = validRun(input.data.runId);
    if (!run) return c.json(problem("RUN_NOT_READY", "Wait for the calibration pattern to finish."), 409);
    if ([...run.uploads.values()].some(upload => upload.cameraId === `camera-${input.data.column}`)) return c.json(problem("CAMERA_ALREADY_UPLOADED", "This camera already has a recording."), 409);
    await prune();
    if ([...transfers.values()].filter(transfer => !transfer.receipt).length >= 12) return c.json(problem("UPLOAD_LIMIT", "Too many unfinished uploads. Finish an existing upload first."), 409);
    const id = crypto.randomUUID();
    transfers.set(id, { ...input.data, id, owner: c.req.header("x-upload-token")!, epoch: deps.clock.serverEpoch,
      expires: deps.clock.nowServerMs() + 2 * 60 * 60 * 1000, busy: false, chunks: new Map() });
    return c.json({ uploadId: id, chunkBytes: CAMERA_CHUNK_BYTES });
  });
  app.put("/api/camera/uploads/:id/:index", async c => {
    const transfer = transfers.get(c.req.param("id"));
    if (!transfer || transfer.owner !== c.req.header("x-upload-token") || transfer.epoch !== deps.clock.serverEpoch) return c.json(problem("UNKNOWN_UPLOAD", "Start this upload again."), 404);
    if (!validRun(transfer.runId)) return c.json(problem("RUN_CLOSED", "This calibration is no longer accepting recordings."), 409);
    const index = Number(c.req.param("index"));
    const count = Math.ceil(transfer.byteSize / CAMERA_CHUNK_BYTES);
    const expected = Math.min(CAMERA_CHUNK_BYTES, transfer.byteSize - index * CAMERA_CHUNK_BYTES);
    const hash = c.req.header("x-chunk-sha256");
    if (!Number.isInteger(index) || index < 0 || index >= count || !hash || !/^[a-f0-9]{64}$/.test(hash) || !c.req.raw.body) return c.json(problem("INVALID_CHUNK", "Invalid upload chunk."), 400);
    const previous = transfer.chunks.get(index);
    if (previous) return previous.sha256 === hash ? c.json({ index, received: previous.byteSize }) : c.json(problem("CHUNK_CONFLICT", "This chunk belongs to a different file."), 409);
    if (transfer.busy || transfer.receipt) return c.json(problem("UPLOAD_BUSY", "Wait for this upload to finish."), 409);
    transfer.busy = true;
    const id = `${transfer.id}-${index}`;
    try {
      const written = await deps.uploads.write(id, c.req.raw.body, expected);
      if (written.byteSize !== expected || written.sha256 !== hash) { await deps.uploads.discard(id); return c.json(problem("CHUNK_MISMATCH", "The upload was interrupted. Retry this chunk."), 400); }
      transfer.chunks.set(index, { id, ...written });
      return c.json({ index, received: written.byteSize });
    } finally { transfer.busy = false; }
  });
  app.get("/api/camera/uploads/:id", c => {
    const transfer = transfers.get(c.req.param("id"));
    if (!transfer || transfer.owner !== c.req.header("x-upload-token") || transfer.epoch !== deps.clock.serverEpoch) return c.json(problem("UNKNOWN_UPLOAD", "Start this upload again."), 404);
    return c.json({ received: [...transfer.chunks.keys()], receipt: transfer.receipt ?? null });
  });
  app.post("/api/camera/uploads/:id/complete", async c => {
    const transfer = transfers.get(c.req.param("id"));
    if (!transfer || transfer.owner !== c.req.header("x-upload-token") || transfer.epoch !== deps.clock.serverEpoch) return c.json(problem("UNKNOWN_UPLOAD", "Start this upload again."), 404);
    if (transfer.receipt) return c.json(transfer.receipt as object);
    const run = validRun(transfer.runId);
    if (!run || run.uploads.size >= 3 || [...run.uploads.values()].some(upload => upload.cameraId === `camera-${transfer.column}`)) return c.json(problem("UPLOAD_CONFLICT", "The calibration or camera changed. Refresh before uploading again."), 409);
    const count = Math.ceil(transfer.byteSize / CAMERA_CHUNK_BYTES);
    if (transfer.chunks.size !== count || transfer.busy) return c.json(problem("UPLOAD_INCOMPLETE", "Wait for all video chunks to finish."), 409);
    transfer.busy = true;
    async function* readChunks() {
      for (let index = 0; index < count; index++) {
        const reader = Bun.file(deps.uploads.path(transfer!.chunks.get(index)!.id)!).stream().getReader();
        try { for (;;) { const part = await reader.read(); if (part.done) break; yield part.value; } }
        finally { reader.releaseLock(); }
      }
    }
    const iterator = readChunks();
    const stream = new ReadableStream<Uint8Array>({ async pull(controller) { const part = await iterator.next(); if (part.done) controller.close(); else controller.enqueue(part.value); }, async cancel() { await iterator.return(); } });
    try {
      const written = await deps.uploads.write(transfer.id, stream, transfer.byteSize);
      if (transfer.epoch !== deps.clock.serverEpoch || !validRun(transfer.runId) || run.uploads.size >= 3 || [...run.uploads.values()].some(upload => upload.cameraId === `camera-${transfer.column}`)) {
        await deps.uploads.discard(transfer.id); return c.json(problem("UPLOAD_CONFLICT", "The calibration changed while the video finished."), 409);
      }
      const upload = { uploadId: transfer.id, runId: transfer.runId, cameraId: `camera-${transfer.column}`, primaryColumn: transfer.column,
        rotationDegrees: transfer.rotationDegrees, anchors: null, frameLayout: "from-stage" as const, exclusionRois: [], label: transfer.label, ...written };
      deps.calibrations.addUpload(upload); transfer.receipt = upload;
      for (const chunk of transfer.chunks.values()) await deps.uploads.discard(chunk.id);
      transfer.chunks.clear();
      return c.json(upload);
    } finally { transfer.busy = false; }
  });
}
