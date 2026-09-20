import { mkdir, writeFile } from "node:fs/promises";
import { join as joinPath, resolve } from "node:path";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  ApiError, AssignmentRequest, CalibrationArmRequest, CalibrationCreateRequest, CalibrationManifest, CalibrationRun,
  CommandAccepted, CommitMapRequest, CreateJobRequest, JobProgress, JoinRequest, JoinResponse, MixRequest,
  PanicRequest, PROTOCOL_VERSION,
  SaveShowRequest, Track, TransportRequest,
} from "@orchestra/contracts";
import { UploadTooLarge, type AssetStore } from "./assets";
import { matchesOperatorSecret } from "./auth";
import { Barrier } from "./barriers";
import { MAX_CAMERAS, type CalibrationRuns } from "./calibration";
import { identityMismatch } from "./jobs";
import type { JobRunner } from "./jobs";
import type { AudioLease } from "./lease";
import type { LoopLagSampler } from "./loop-lag";
import type { ServerClock } from "./clock";
import type { CheckpointStore } from "./checkpoint";
import type { CommandLog } from "./commands";
import type { ConnectionRegistry } from "./connections";
import type { Preparations } from "./preparations";
import type { DeviceRegistry } from "./registry";
import type { RateLimiter } from "./rate-limit";
import type { SessionState } from "./state";
import { nextTransport, positionAt } from "./transport";
import { validateShow } from "./show-validation";
import { registerStageRoutes } from "./stage-routes";

export const DEFAULT_LEAD_TIME_MS = 3000;

const numeric = z.coerce.number();
const CameraUploadQuery = z.object({
  commandId: z.string().min(1).max(160),
  cameraId: z.string().min(1).max(160),
  primaryColumn: z.enum(["left", "center", "right"]),
  rotationDegrees: z.coerce.number().int().refine(value => [0, 90, 180, 270].includes(value), "unsupported rotation"),
  byteSize: numeric.int().positive().max(1024 * 1024 * 1024),
  label: z.string().min(1).max(200),
  anchors: z.string().optional(),
  exclusionRois: z.string().optional(),
});

const Point = z.object({ x: z.number(), y: z.number() });
const Anchors = z.tuple([Point, Point, Point, Point]);
const ExclusionRois = z.array(z.array(Point).min(3));
const parseJson = <T>(schema: z.ZodType<T>, raw: string | undefined, fallback: T): T | null => {
  if (raw === undefined) return fallback;
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
};
const AssetUpload = z.object({
  commandId: z.string().min(1).max(160),
  label: z.string().min(1).max(200),
  byteSize: numeric.int().positive().max(128 * 1024 * 1024),
  durationMs: numeric.positive(),
  sampleRateHz: numeric.int().positive(),
  channels: numeric.int().min(1).max(2),
});

export interface AppDeps {
  clock: ServerClock;
  registry: DeviceRegistry;
  store: CheckpointStore;
  joins: RateLimiter;
  state: SessionState;
  commands: CommandLog;
  connections: ConnectionRegistry;
  preparations: Preparations;
  assets: AssetStore;
  uploads: AssetStore;
  calibrations: CalibrationRuns;
  jobs: JobRunner;
  lease: AudioLease;
  loopLag?: LoopLagSampler;
  jobWorkspace: string;
  operatorSecret?: string;
  leadTimeMs?: number;
}

const apiError = (code: string, message: string, retryable = false) =>
  ApiError.parse({ protocolVersion: PROTOCOL_VERSION, error: { code, message, retryable, owner: "sync-control" } });

const envelope = (clock: ServerClock) => ({
  protocolVersion: PROTOCOL_VERSION, sessionId: clock.sessionId, serverEpoch: clock.serverEpoch,
  messageId: crypto.randomUUID(),
});

const accepted = (clock: ServerClock, commandId: string, revision: number) =>
  CommandAccepted.parse({
    protocolVersion: PROTOCOL_VERSION, sessionId: clock.sessionId, serverEpoch: clock.serverEpoch,
    commandId, revision,
  });

// Checks every mutation shares before it touches state.
const guardCommand = (deps: AppDeps, request: { sessionId: string; serverEpoch: string }) => {
  if (request.sessionId !== deps.clock.sessionId) {
    return { body: apiError("WRONG_SESSION", "This server is not serving that concert session."), status: 404 as const };
  }
  // A command minted under a previous epoch was scheduled against a clock origin that no longer
  // exists; its effective time means nothing now.
  if (request.serverEpoch !== deps.clock.serverEpoch) {
    return {
      body: apiError("STALE_EPOCH", "The server restarted; resynchronize and reissue this command.", true),
      status: 409 as const,
    };
  }
  return null;
};

const leadTimeError = (deps: AppDeps, effectiveServerMs: number, nowServerMs: number) => {
  const leadTimeMs = deps.leadTimeMs ?? DEFAULT_LEAD_TIME_MS;
  if (effectiveServerMs >= nowServerMs + leadTimeMs) return null;
  return {
    body: apiError(
      "INSUFFICIENT_LEAD_TIME",
      `A scheduled change must be at least ${leadTimeMs} ms in the future; phones need time to schedule it.`,
    ),
    status: 409 as const,
  };
};

export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof UploadTooLarge) return c.json(apiError("UPLOAD_TOO_LARGE", error.message), 413);
    console.error("Request failed:", error.stack ?? error.message);
    return c.json(apiError("INTERNAL_ERROR", "The operation failed. Check the server log before retrying.", true), 500);
  });
  deps.state.setAdminContext(() => ({ preparations: deps.preparations.snapshot(), calibration: deps.calibrations.resource() }));
  const persist = () =>
    deps.store.save(deps.registry.toCheckpoint(
      deps.clock.sessionId, deps.state.durableShow,
      deps.state.mapRevision > 0 ? deps.state.audienceMap : null,
      deps.state.lastCommittedRunTag,
      deps.state.durableAssignments, deps.calibrations.nextTag,
    ));
  app.use("/api/*", cors({ origin: (origin, c) => {
    const allowed = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001").split(",");
    if (allowed.includes(origin)) return origin;
    try { if (process.env.NODE_ENV !== "production" && new URL(origin).hostname === new URL(c.req.url).hostname) return origin; } catch { /* invalid origin */ }
    return undefined;
  } }));
  app.get("/api/session", c => c.json({ protocolVersion: 1, sessionId: deps.clock.sessionId, serverEpoch: deps.clock.serverEpoch }));
  let mutationQueue = Promise.resolve();
  app.use("/api/*", async (c, next) => {
    // Serialize short operator transactions across checkpoint awaits. Upload streams and joins
    // retain their independent paths, so media cannot block clock probes or session admission.
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) || /\/join$|\/uploads(?:\/|$)|\/assets$/.test(c.req.path)) return next();
    const previous = mutationQueue;
    let release!: () => void;
    mutationQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { await next(); } finally { release(); }
  });
  app.get("/api/health", c => c.json({
    service: "audience-orchestra-control", protocolVersion: 1, implementation: "sync-control",
  }));
  registerStageRoutes(app, deps, persist);
  app.get("/api/foundation", c => c.json({
    status: "software-complete", owner: "sync-control",
    implemented: [
      "health", "foundation-info", "clock-websocket", "join-resume", "role-filtered-snapshots",
      "show-save", "prepared-transport-cues", "assignments", "mix", "assets", "calibration-runs",
      "camera-uploads", "otc-jobs", "map-commit", "panic", "audio-lease",
    ],
    next: ["consumer integration", "physical phone, audio and venue tests"],
    // Diagnostics, not a contract surface: the load harness reads this to report whether the
    // control process stayed responsive.
    diagnostics: {
      devices: deps.registry.size,
      connectedDevices: deps.state.connectedDeviceIds().length,
      revision: deps.state.revision,
      eventLoopLagMs: deps.loopLag?.summary() ?? null,
    },
  }));

  app.post("/api/sessions/:sessionId/join", async c => {
    if (c.req.param("sessionId") !== deps.clock.sessionId) {
      return c.json(apiError("WRONG_SESSION", "This server is not serving that concert session."), 404);
    }
    if (!deps.joins.take()) {
      return c.json(apiError("RATE_LIMITED", "Too many joins right now; retry shortly.", true), 429);
    }
    const body = JoinRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json(apiError("INVALID_REQUEST", "Join body did not match the protocol v1 schema."), 400);

    const joiningEpoch = deps.clock.serverEpoch;
    const outcome = deps.registry.join(body.data.resumeToken, deps.clock.nowServerMs());
    if (!outcome.ok) {
      return outcome.code === "CAPACITY_REACHED"
        ? c.json(apiError("CAPACITY_REACHED", `Session is full at ${deps.registry.size} devices.`), 503)
        : c.json(apiError("INVALID_RESUME_TOKEN", "Resume token is not valid for this session."), 401);
    }
    // A newly allocated identity is durable before the client is told it owns one.
    if (outcome.allocated) await persist();
    if (joiningEpoch !== deps.clock.serverEpoch) return c.json(apiError("SESSION_RESET", "The audience was reset. Join again.", true), 409);
    deps.state.register(outcome.deviceId);

    return c.json(JoinResponse.parse({
      protocolVersion: PROTOCOL_VERSION,
      sessionId: deps.clock.sessionId,
      serverEpoch: deps.clock.serverEpoch,
      deviceId: outcome.deviceId,
      resumeToken: outcome.resumeToken,
      revision: deps.state.revision,
    }));
  });

  // Role filtering happens here, not in the client: a participant is never sent another
  // phone's telemetry, and the operator view needs a credential the QR code does not grant.
  const readSnapshot = (allowOperator: boolean) => (c: Context) => {
    if (c.req.param("sessionId") !== deps.clock.sessionId) {
      return c.json(apiError("WRONG_SESSION", "This server is not serving that concert session."), 404);
    }
    if (allowOperator && matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(deps.state.adminSnapshot(deps.clock));
    }
    const resumeToken = c.req.header("x-resume-token");
    const deviceId = resumeToken === undefined ? null : deps.registry.authenticate(resumeToken);
    if (deviceId === null) {
      return c.json(apiError("UNAUTHORIZED", allowOperator ? "Provide a valid resume token or the operator secret." : "Provide a valid participant resume token."), 401);
    }
    const snapshot = deps.state.participantSnapshot(deviceId, deps.clock);
    if (!snapshot) return c.json(apiError("UNKNOWN_DEVICE", "This device is not registered in the current session."), 404);
    return c.json(snapshot);
  };
  app.get("/api/sessions/:sessionId/snapshot", readSnapshot(true));
  app.get("/api/sessions/:sessionId/participant-snapshot", readSnapshot(false));

  app.put("/api/show", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Saving a show requires the operator secret."), 401);
    }
    const body = SaveShowRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("INVALID_REQUEST", "Show request did not match the protocol v1 schema."), 400);
    if (body.data.sessionId !== deps.clock.sessionId) {
      return c.json(apiError("WRONG_SESSION", "This server is not serving that concert session."), 404);
    }
    const guard = guardCommand(deps, body.data);
    if (guard) return c.json(guard.body, guard.status);
    const showError = validateShow(body.data.show);
    if (showError) return c.json(apiError("INVALID_SHOW", showError), 400);

    // Replay before validation: a retry of a command that already succeeded returns its original
    // result even though the revision it expected has since moved on.
    const replayed = deps.commands.get<unknown>(body.data.commandId);
    if (replayed) return c.json(replayed);

    if (deps.state.transport.status !== "stopped" || deps.state.pendingActions.length > 0) {
      return c.json(apiError("TRANSPORT_NOT_STOPPED", "A show can only be saved while the transport is stopped."), 409);
    }
    if (body.data.expectedRevision !== deps.state.showRevision) {
      return c.json(apiError(
        "REVISION_CONFLICT",
        `Show is at revision ${deps.state.showRevision}; reload before saving.`,
      ), 409);
    }

    const saved = deps.state.saveShow(body.data.show);
    await persist();
    const barrier = new Barrier(crypto.randomUUID(), saved.showRevision, deps.state.transport.transportRevision, deps.state.connectedDeviceIds());
    deps.preparations.start("assets", barrier);
    deps.connections.sendToParticipants(barrier.expectedDevices(), JSON.stringify({ ...envelope(deps.clock), type: "assets.prepare", revision: deps.state.revision,
      payload: { preparationId: barrier.preparationId, show: saved } }));
    const ack = accepted(deps.clock, body.data.commandId, saved.showRevision);
    deps.commands.remember(body.data.commandId, ack);
    return c.json(ack);
  });

  app.post("/api/transport", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Transport control requires the operator secret."), 401);
    }
    const body = TransportRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("INVALID_REQUEST", "Transport request did not match the protocol v1 schema."), 400);
    const request = body.data;
    const guard = guardCommand(deps, request);
    if (guard) return c.json(guard.body, guard.status);

    const replayed = deps.commands.get<unknown>(request.commandId);
    if (replayed) return c.json(replayed);

    const now = deps.clock.nowServerMs();
    deps.state.applyDue(now);
    if (request.expectedRevision !== deps.state.transportRevision) {
      return c.json(apiError(
        "REVISION_CONFLICT",
        `Transport is at revision ${deps.state.transport.transportRevision}; reload before commanding.`,
      ), 409);
    }
    if (request.showRevision !== deps.state.showRevision) {
      return c.json(apiError("STALE_SHOW", `Show is at revision ${deps.state.showRevision}.`), 409);
    }

    if (request.action === "prepare") {
      const barrier = new Barrier(
        crypto.randomUUID(), deps.state.showRevision, deps.state.transportRevision,
        deps.state.connectedDeviceIds(),
      );
      deps.preparations.start("transport", barrier);
      deps.connections.sendToParticipants(deps.state.connectedDeviceIds(), JSON.stringify({
        ...envelope(deps.clock), type: "transport.prepare", revision: deps.state.revision,
        payload: {
          preparationId: barrier.preparationId, showRevision: barrier.showRevision,
          transportRevision: barrier.transportRevision,
        },
      }));
      const ack = accepted(deps.clock, request.commandId, deps.state.transport.transportRevision);
      deps.commands.remember(request.commandId, ack);
      return c.json(ack);
    }

    const leadTime = leadTimeError(deps, request.effectiveServerMs, now);
    if (leadTime) return c.json(leadTime.body, leadTime.status);

    // Starting playback is the only action gated on readiness. Stopping or pausing must never
    // wait for a phone that is not answering.
    const barrier = deps.preparations.current("transport");
    if (request.action === "play") {
      if (!barrier || barrier.showRevision !== deps.state.showRevision
        || barrier.transportRevision !== deps.state.transportRevision) {
        return c.json(apiError("NOT_PREPARED", "Prepare this show and transport revision before starting playback."), 409);
      }
      if (barrier.readyDevices().length === 0) {
        return c.json(apiError("NOBODY_READY", "No device has acknowledged this preparation."), 409);
      }
    }

    const transport = { ...nextTransport({
      current: deps.state.transport, action: request.action, showRevision: deps.state.showRevision,
      positionMs: request.action === "play" || request.action === "seek"
        ? request.positionMs
        : positionAt(deps.state.transport, request.effectiveServerMs),
      effectiveServerMs: request.effectiveServerMs,
    }), transportRevision: deps.state.transportRevision + 1 };

    // A deliberate transport command is how an operator comes back from a panic.
    deps.lease.resume();
    const recipients = request.action === "play" && barrier ? barrier.readyDevices()
      : transport.status === "playing" ? deps.state.playbackDeviceIds() : deps.state.connectedDeviceIds();
    const superseded = deps.state.scheduleTransport({
      domain: "transport", commandId: request.commandId, effectiveServerMs: request.effectiveServerMs,
      supersedesCommandId: null, transport,
    }, recipients);
    deps.connections.sendToParticipants(recipients, JSON.stringify({
      ...envelope(deps.clock), type: "transport.commit", revision: deps.state.revision,
      effectiveServerMs: request.effectiveServerMs,
      payload: { domain: "transport", commandId: request.commandId, effectiveServerMs: request.effectiveServerMs, supersedesCommandId: superseded, transport },
    }));
    if (request.action !== "play") deps.preparations.clear("transport");
    const ack = { ...accepted(deps.clock, request.commandId, transport.transportRevision), effectiveServerMs: request.effectiveServerMs,
      ready: recipients.length, excluded: request.action === "play" && barrier ? barrier.expectedDevices().filter(id => !recipients.includes(id)).map(deviceId => ({ deviceId, reason: barrier.excludedDevices().find(item => item.deviceId === deviceId)?.reason ?? "not acknowledged" })) : [] };
    deps.commands.remember(request.commandId, ack);
    return c.json(ack);
  });

  // Metadata travels in the query so the body stays a raw stream. Duration, sample rate and
  // channel count are declared by the operator and not verified here: decoding audio in the
  // control process is exactly the CPU work that belongs elsewhere. Size and hash are measured.
  app.post("/api/assets", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Registering an asset requires the operator secret."), 401);
    }
    const query = AssetUpload.safeParse(c.req.query());
    if (!query.success) return c.json(apiError("INVALID_REQUEST", "Asset metadata was missing or malformed."), 400);

    const replayed = deps.commands.get<unknown>(query.data.commandId);
    if (replayed) return c.json(replayed);

    const body = c.req.raw.body;
    if (!body) return c.json(apiError("INVALID_REQUEST", "Asset upload had no body."), 400);

    const trackId = crypto.randomUUID();
    const written = await deps.assets.write(trackId, body, query.data.byteSize);
    // A short read means the connection dropped mid-upload. Registering it would put a hash in a
    // show that no phone can ever match.
    if (written.byteSize !== query.data.byteSize) {
      await deps.assets.discard(trackId);
      return c.json(apiError(
        "TRUNCATED_UPLOAD",
        `Expected ${query.data.byteSize} bytes and received ${written.byteSize}.`,
        true,
      ), 400);
    }

    const track = Track.parse({
      trackId, label: query.data.label, url: `/api/assets/${trackId}`,
      sha256: written.sha256, byteSize: written.byteSize,
      durationMs: query.data.durationMs, sampleRateHz: query.data.sampleRateHz, channels: query.data.channels,
    });
    deps.commands.remember(query.data.commandId, track);
    return c.json(track);
  });

  // Unauthenticated on purpose: every participant needs the audio, the id is unguessable, and
  // this is the route that should move to a static host or CDN before the event.
  app.get("/api/assets/:trackId", async c => {
    const trackId = c.req.param("trackId");
    const path = deps.assets.path(trackId);
    if (!path || !(await deps.assets.exists(trackId))) {
      return c.json(apiError("UNKNOWN_ASSET", "No such asset in this session."), 404);
    }
    return new Response(Bun.file(path), {
      headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" },
    });
  });

  app.post("/api/calibrations", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Creating a calibration run requires the operator secret."), 401);
    }
    const body = CalibrationCreateRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("INVALID_REQUEST", "Calibration request did not match the protocol v1 schema."), 400);
    const request = body.data;
    const guard = guardCommand(deps, request);
    if (guard) return c.json(guard.body, guard.status);

    const replayed = deps.commands.get<unknown>(request.commandId);
    if (replayed) return c.json(replayed);

    // Only phones that are actually here can be frozen into the run. A participant that is not
    // connected cannot render the packet, and counting it would only produce a phantom exclusion.
    const connected = new Set(deps.state.connectedDeviceIds());
    const participantIds = request.participantIds.filter(deviceId => connected.has(deviceId));
    if (participantIds.length === 0) {
      return c.json(apiError("NO_ELIGIBLE_PARTICIPANTS", "None of the named devices are connected."), 409);
    }

    const outcome = deps.calibrations.create({
      sessionId: deps.clock.sessionId, serverEpoch: deps.clock.serverEpoch,
      participantIds, palette: request.palette, paletteVersion: request.paletteVersion,
    });
    if (!outcome.ok) {
      return outcome.code === "RUN_IN_PROGRESS"
        ? c.json(apiError("RUN_IN_PROGRESS", "Finish or discard the active calibration run first."), 409)
        : c.json(apiError("RUN_TAGS_EXHAUSTED", "This session has used all 256 run tags; start a new session."), 409);
    }

    const barrier = new Barrier(crypto.randomUUID(), deps.state.showRevision, deps.state.transport.transportRevision, participantIds);
    outcome.run.preparationId = barrier.preparationId;
    deps.state.calibrationStage = "calibrating";
    deps.preparations.start("calibration", barrier);
    await persist();
    deps.connections.sendToParticipants(participantIds, JSON.stringify({
      ...envelope(deps.clock), type: "calibration.prepare", revision: deps.state.revision,
      payload: { preparationId: barrier.preparationId, plan: outcome.run.plan },
    }));

    // The plan is returned whole and unmodified so it stays a valid contract object; the
    // preparation id travels beside it rather than inside it.
    const result = { plan: outcome.run.plan, preparationId: barrier.preparationId };
    deps.commands.remember(request.commandId, result);
    return c.json(result);
  });

  app.post("/api/calibrations/:runId/arm", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Arming a calibration run requires the operator secret."), 401);
    }
    const body = CalibrationArmRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("INVALID_REQUEST", "Arm request did not match the protocol v1 schema."), 400);
    const request = body.data;
    const guard = guardCommand(deps, request);
    if (guard) return c.json(guard.body, guard.status);

    const replayed = deps.commands.get<unknown>(request.commandId);
    if (replayed) return c.json(replayed);

    const run = deps.calibrations.get(c.req.param("runId"));
    if (!run || run.plan.runId !== request.runId) {
      return c.json(apiError("UNKNOWN_RUN", "No such calibration run in this session."), 404);
    }
    if (run.status !== "created") {
      return c.json(apiError("RUN_NOT_ARMABLE", `This run is ${run.status}.`), 409);
    }

    // The acknowledgements have to name the preparation the operator is looking at, or the
    // ready count on screen describes a different run than the one about to start.
    const barrier = deps.preparations.current("calibration");
    if (!barrier || barrier.preparationId !== request.preparationId) {
      return c.json(apiError("STALE_PREPARATION", "That preparation is no longer the current one."), 409);
    }
    if (barrier.readyDevices().length === 0) {
      return c.json(apiError("NOBODY_READY", "No device has acknowledged this calibration."), 409);
    }
    const leadTime = leadTimeError(deps, request.effectiveServerMs, deps.clock.nowServerMs());
    if (leadTime) return c.json(leadTime.body, leadTime.status);

    deps.calibrations.arm(run.plan.runId, request.effectiveServerMs);
    const armed = CalibrationRun.parse({ ...run.plan, startServerMs: request.effectiveServerMs });
    deps.connections.sendToParticipants(barrier.readyDevices(), JSON.stringify({
      ...envelope(deps.clock), type: "calibration.arm", revision: deps.state.revision,
      effectiveServerMs: request.effectiveServerMs,
      payload: { preparationId: barrier.preparationId, run: armed },
    }));

    const ack = accepted(deps.clock, request.commandId, deps.state.revision);
    const result = { ...ack, effectiveServerMs: request.effectiveServerMs, excluded: barrier.excludedDevices(), ready: barrier.readyDevices().length };
    deps.commands.remember(request.commandId, result);
    return c.json(result);
  });

  // The submitted label is recorded for the operator and never used as a path: the file lands
  // under a server-generated id.
  app.post("/api/calibrations/:runId/uploads", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Uploading a recording requires the operator secret."), 401);
    }
    const query = CameraUploadQuery.safeParse(c.req.query());
    if (!query.success) return c.json(apiError("INVALID_REQUEST", "Upload metadata was missing or malformed."), 400);

    const replayed = deps.commands.get<unknown>(query.data.commandId);
    if (replayed) return c.json(replayed);

    const run = deps.calibrations.get(c.req.param("runId"));
    if (!run) return c.json(apiError("UNKNOWN_RUN", "No such calibration run in this session."), 404);
    if (run.status === "committed" || run.status === "discarded") {
      return c.json(apiError("RUN_CLOSED", `This run is ${run.status}.`), 409);
    }
    const existing = [...run.uploads.values()];
    if (existing.some(upload => upload.cameraId === query.data.cameraId)) {
      return c.json(apiError("CAMERA_ALREADY_UPLOADED", `Camera ${query.data.cameraId} already has a recording for this run.`), 409);
    }
    if (existing.length >= MAX_CAMERAS) {
      return c.json(apiError("TOO_MANY_CAMERAS", `A run accepts at most ${MAX_CAMERAS} recordings.`), 409);
    }

    // Camera geometry is optional: without it Team 3 falls back to the manual column path, which
    // the masterplan requires to work on its own.
    const anchors = parseJson(Anchors, query.data.anchors, null);
    const exclusionRois = parseJson(ExclusionRois, query.data.exclusionRois, []);
    if (anchors === null && query.data.anchors !== undefined) {
      return c.json(apiError("INVALID_REQUEST", "Anchors must be four ordered points."), 400);
    }
    if (exclusionRois === null) {
      return c.json(apiError("INVALID_REQUEST", "Exclusion regions must be polygons of at least three points."), 400);
    }

    const body = c.req.raw.body;
    if (!body) return c.json(apiError("INVALID_REQUEST", "Upload had no body."), 400);

    const uploadId = crypto.randomUUID();
    const written = await deps.uploads.write(uploadId, body, query.data.byteSize);
    if (written.byteSize !== query.data.byteSize) {
      await deps.uploads.discard(uploadId);
      return c.json(apiError(
        "TRUNCATED_UPLOAD", `Expected ${query.data.byteSize} bytes and received ${written.byteSize}.`, true,
      ), 400);
    }

    // Another request may finish while this recording streams. Recheck before registering it.
    if (["committed", "discarded"].includes(run.status) || run.uploads.size >= MAX_CAMERAS
      || [...run.uploads.values()].some(upload => upload.cameraId === query.data.cameraId)) {
      await deps.uploads.discard(uploadId);
      return c.json(apiError("UPLOAD_CONFLICT", "The run or camera changed during upload. Refresh before retrying."), 409);
    }
    const upload = {
      uploadId, runId: run.plan.runId, cameraId: query.data.cameraId,
      primaryColumn: query.data.primaryColumn,
      rotationDegrees: query.data.rotationDegrees as 0 | 90 | 180 | 270,
      sha256: written.sha256, byteSize: written.byteSize, label: query.data.label,
      anchors, exclusionRois,
    };
    deps.calibrations.addUpload(upload);
    deps.commands.remember(query.data.commandId, upload);
    return c.json(upload);
  });

  app.patch("/api/calibrations/:runId/uploads/:uploadId", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) return c.json(apiError("UNAUTHORIZED", "Operator access required."), 401);
    const run = deps.calibrations.get(c.req.param("runId"));
    const upload = run?.uploads.get(c.req.param("uploadId"));
    if (!run || !upload) return c.json(apiError("UNKNOWN_UPLOAD", "No such recording in this run."), 404);
    if (run.status === "committed" || run.status === "discarded") return c.json(apiError("RUN_CLOSED", "This run is closed."), 409);
    const parsed = z.strictObject({ primaryColumn: z.enum(["left", "center", "right"]),
      rotationDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
      anchors: Anchors.nullable(), exclusionRois: ExclusionRois }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(apiError("INVALID_GEOMETRY", "Use four anchors, valid exclusion polygons, and a supported rotation."), 400);
    Object.assign(upload, parsed.data);
    return c.json(upload);
  });

  app.post("/api/calibrations/:runId/jobs", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Starting a job requires the operator secret."), 401);
    }
    const body = CreateJobRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("INVALID_REQUEST", "Job request did not match the protocol v1 schema."), 400);
    const request = body.data;
    const guard = guardCommand(deps, request);
    if (guard) return c.json(guard.body, guard.status);

    const replayed = deps.commands.get<unknown>(request.commandId);
    if (replayed) return c.json(replayed);

    const run = deps.calibrations.get(c.req.param("runId"));
    if (!run || run.plan.runId !== request.runId) {
      return c.json(apiError("UNKNOWN_RUN", "No such calibration run in this session."), 404);
    }
    if (run.status === "committed" || run.status === "discarded") return c.json(apiError("RUN_CLOSED", "This run is closed."), 409);
    if (new Set(request.uploadIds).size !== request.uploadIds.length) return c.json(apiError("DUPLICATE_CAMERA", "Choose each recording once."), 400);
    // Without a start time there is no packet timing to decode against.
    if (run.startServerMs === null) {
      return c.json(apiError("RUN_NOT_ARMED", "Arm this run before processing its recordings."), 409);
    }
    const uploads = request.uploadIds.map(uploadId => run.uploads.get(uploadId));
    if (uploads.some(upload => !upload)) {
      return c.json(apiError("UNKNOWN_UPLOAD", "One or more uploads do not belong to this run."), 409);
    }

    const cameras = uploads.map(upload => ({
      cameraId: upload!.cameraId, primaryColumn: upload!.primaryColumn,
      videoPath: resolve(deps.uploads.path(upload!.uploadId)!), sha256: upload!.sha256,
      rotationDegrees: upload!.rotationDegrees,
      exclusionRois: upload!.exclusionRois, anchors: upload!.anchors,
    }));
    const participantIds = run.plan.participantIds.filter(id => run.reports.get(id)?.completed !== false);
    if (!participantIds.length) return c.json(apiError("NO_CAPTURED_PHONES", "Every participating phone reported an interrupted pattern. Capture a new run."), 409);
    const manifest = CalibrationManifest.parse({ ...run.plan, participantIds, startServerMs: run.startServerMs, cameras });

    const jobId = crypto.randomUUID();
    const manifestPath = joinPath(deps.jobWorkspace, `${jobId}.manifest.json`);
    const outputPath = joinPath(deps.jobWorkspace, `${jobId}.result.json`);
    await mkdir(deps.jobWorkspace, { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    deps.calibrations.setStatus(run.plan.runId, "processing");
    deps.state.calibrationStage = "processing";
    const record = deps.jobs.enqueue({ jobId, runId: run.plan.runId, manifestPath: resolve(manifestPath), outputPath: resolve(outputPath), manifest, evidence: request.evidence });
    const progress = JobProgress.parse({
      protocolVersion: PROTOCOL_VERSION, jobId, runId: run.plan.runId,
      stage: record.stage, progress: record.progress, message: record.message,
    });
    deps.commands.remember(request.commandId, progress);
    return c.json(progress);
  });

  app.get("/api/jobs/:jobId", c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Reading job progress requires the operator secret."), 401);
    }
    const record = deps.jobs.get(c.req.param("jobId"));
    if (!record) return c.json(apiError("UNKNOWN_JOB", "No such job in this session."), 404);
    return c.json({
      progress: JobProgress.parse({
        protocolVersion: PROTOCOL_VERSION, jobId: record.jobId, runId: record.runId,
        stage: record.stage, progress: record.progress, message: record.message,
      }),
      diagnostics: record.diagnostics,
      result: record.result,
    });
  });

  app.get("/api/calibrations/:runId", c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) return c.json(apiError("UNAUTHORIZED", "Operator access required."), 401);
    const run = deps.calibrations.get(c.req.param("runId"));
    if (!run) return c.json(apiError("UNKNOWN_RUN", "No such calibration run."), 404);
    return c.json(deps.calibrations.resource(run));
  });
  app.get("/api/jobs/:jobId/debug/:name", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) return c.json(apiError("UNAUTHORIZED", "Operator access required."), 401);
    const job = deps.jobs.get(c.req.param("jobId"));
    const name = c.req.param("name");
    if (!job || job.stage !== "complete" || !/^(index\.json|camera-[0-2]\.(png|json))$/.test(name)) return c.json(apiError("UNKNOWN_ARTIFACT", "No such completed review artifact."), 404);
    const file = Bun.file(joinPath(deps.jobWorkspace, `${job.jobId}.result.json.debug`, name));
    if (!await file.exists()) return c.json(apiError("UNKNOWN_ARTIFACT", "Review artifact unavailable."), 404);
    return new Response(file, { headers: { "cache-control": "no-store" } });
  });

  app.delete("/api/jobs/:jobId", c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Cancelling a job requires the operator secret."), 401);
    }
    const cancelled = deps.jobs.cancel(c.req.param("jobId"));
    if (!cancelled) return c.json(apiError("JOB_NOT_CANCELLABLE", "That job is unknown or already finished."), 409);
    return c.json({ jobId: c.req.param("jobId"), cancelled: true });
  });

  // Not in the masterplan's endpoint list, added because without it a failed calibration ends the
  // session: only one run may be active, so a run nobody can commit blocks every later attempt.
  app.delete("/api/calibrations/:runId", c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Discarding a run requires the operator secret."), 401);
    }
    const run = deps.calibrations.get(c.req.param("runId"));
    if (!run) return c.json(apiError("UNKNOWN_RUN", "No such calibration run in this session."), 404);
    if (run.status === "committed") {
      return c.json(apiError("RUN_ALREADY_COMMITTED", "A committed run cannot be discarded; its map is in use."), 409);
    }
    deps.calibrations.setStatus(run.plan.runId, "discarded");
    deps.state.calibrationStage = deps.state.audienceMap.runId ? "complete" : "waiting";
    deps.preparations.clear("calibration");
    return c.json({ runId: run.plan.runId, status: "discarded" });
  });

  app.post("/api/calibrations/:runId/commit-map", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Committing a map requires the operator secret."), 401);
    }
    const body = CommitMapRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("INVALID_REQUEST", "Commit request did not match the protocol v1 schema."), 400);
    const request = body.data;
    const guard = guardCommand(deps, request);
    if (guard) return c.json(guard.body, guard.status);

    const replayed = deps.commands.get<unknown>(request.commandId);
    if (replayed) return c.json(replayed);

    const run = deps.calibrations.get(c.req.param("runId"));
    if (!run || run.plan.runId !== request.runId) {
      return c.json(apiError("UNKNOWN_RUN", "No such calibration run in this session."), 404);
    }
    const job = deps.jobs.get(request.jobId);
    if (!job || job.runId !== run.plan.runId) {
      return c.json(apiError("UNKNOWN_JOB", "That job does not belong to this run."), 409);
    }
    if (job.stage !== "complete" || !job.result) {
      return c.json(apiError("JOB_NOT_COMPLETE", `That job is ${job.stage}; only a complete job can be committed.`), 409);
    }

    if (run.status === "discarded") return c.json(apiError("RUN_CLOSED", "This run was discarded."), 409);
    if (job.manifest.participantIds.some(id => run.reports.get(id)?.completed === false)) {
      return c.json(apiError("CAPTURE_CHANGED", "A phone reported an interrupted pattern after processing began. Process and review again."), 409);
    }
    // Validate the exact inputs used by this job, including any geometry edits made since it ran.
    for (const camera of job.manifest.cameras) {
      const current = [...run.uploads.values()].find(upload => upload.cameraId === camera.cameraId);
      if (!current || current.sha256 !== camera.sha256 || current.primaryColumn !== camera.primaryColumn
        || current.rotationDegrees !== camera.rotationDegrees || JSON.stringify(current.anchors) !== JSON.stringify(camera.anchors)
        || JSON.stringify(current.exclusionRois) !== JSON.stringify(camera.exclusionRois)) {
        return c.json(apiError("STALE_GEOMETRY", "Camera metadata changed. Process and review the recordings again."), 409);
      }
    }
    const mismatch = identityMismatch(job.result, job.manifest);
    if (mismatch) return c.json(apiError("RESULT_IDENTITY_MISMATCH", mismatch), 409);

    // A run that started before the one already committed cannot overwrite newer locations,
    // however late its result arrives.
    const committedTag = deps.state.lastCommittedRunTag;
    if (committedTag !== null && run.plan.runTag <= committedTag) {
      return c.json(apiError(
        "STALE_RUN", `Run tag ${run.plan.runTag} is not newer than the committed run tag ${committedTag}.`,
      ), 409);
    }
    if (request.expectedMapRevision !== deps.state.mapRevision) {
      return c.json(apiError(
        "REVISION_CONFLICT", `Audience map is at revision ${deps.state.mapRevision}; reload before committing.`,
      ), 409);
    }

    const mapRevision = deps.state.commitMap({
      runId: run.plan.runId, runTag: run.plan.runTag, evidence: job.result.evidence,
      locations: job.result.locations, targets: run.plan.participantIds,
    });
    deps.calibrations.setStatus(run.plan.runId, "committed");
    deps.state.calibrationStage = "complete";
    await persist();

    const ack = accepted(deps.clock, request.commandId, mapRevision);
    deps.commands.remember(request.commandId, ack);
    return c.json(ack);
  });

  /**
   * Immediate by design. Everything else in this server lands at a common future moment because
   * synchrony matters; this lands now because silence matters more. It is also refused for as few
   * reasons as possible: an operator reaching for panic must never be told to reload first, so a
   * stale revision or a stale epoch does not block it.
   */
  app.post("/api/panic", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Panic requires the operator secret."), 401);
    }
    const body = PanicRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("INVALID_REQUEST", "Panic request did not match the protocol v1 schema."), 400);
    if (body.data.sessionId !== deps.clock.sessionId) {
      return c.json(apiError("WRONG_SESSION", "This server is not serving that concert session."), 404);
    }

    const replayed = deps.commands.get<unknown>(body.data.commandId);
    if (replayed) return c.json(replayed);

    const now = deps.clock.nowServerMs();
    deps.state.panic();
    deps.lease.suspend(now);
    deps.preparations.clear("transport");

    const recipients = deps.state.connectedDeviceIds();
    deps.connections.sendToParticipants(recipients, JSON.stringify({
      ...envelope(deps.clock), type: "panic", revision: deps.state.revision,
      payload: { commandId: body.data.commandId },
    }));
    // Belt and braces: a phone that misses the broadcast still loses permission to make sound.
    deps.connections.sendToParticipants(recipients, JSON.stringify({
      ...envelope(deps.clock), type: "lease.renew", payload: { expiresServerMs: now },
    }));

    await persist();
    const ack = accepted(deps.clock, body.data.commandId, deps.state.transport.transportRevision);
    deps.commands.remember(body.data.commandId, ack);
    return c.json(ack);
  });

  app.on("POST", ["/api/assignments", "/api/assignments/prepare"], async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Assigning devices requires the operator secret."), 401);
    }
    const body = AssignmentRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("INVALID_REQUEST", "Assignment request did not match the protocol v1 schema."), 400);
    const request = body.data;
    const guard = guardCommand(deps, request);
    if (guard) return c.json(guard.body, guard.status);

    const replayed = deps.commands.get<unknown>(request.commandId);
    if (replayed) return c.json(replayed);

    const now = deps.clock.nowServerMs();
    deps.state.applyDue(now);
    if (request.expectedRevision !== deps.state.assignmentRevision) {
      return c.json(apiError(
        "REVISION_CONFLICT", `Assignments are at revision ${deps.state.assignmentRevision}; reload before assigning.`,
      ), 409);
    }
    // A selection made against an older map may name devices that have since moved or been
    // relocalized. The operator reselects rather than the server guessing.
    if (request.mapRevision !== deps.state.mapRevision) {
      return c.json(apiError("STALE_MAP", `Audience map is at revision ${deps.state.mapRevision}; reselect.`), 409);
    }
    if (request.channelId !== null && !deps.state.show.channels.some(channel => channel.channelId === request.channelId)) {
      return c.json(apiError("UNKNOWN_CHANNEL", "No such channel in the current show."), 409);
    }
    const unknown = request.deviceIds.filter(deviceId => !deps.state.isRegistered(deviceId));
    if (unknown.length > 0) {
      return c.json(apiError("UNKNOWN_DEVICE", `Not registered in this session: ${unknown.join(", ")}.`), 409);
    }
    const leadTime = leadTimeError(deps, request.effectiveServerMs, now);
    if (leadTime) return c.json(leadTime.body, leadTime.status);

    const assignmentRevision = deps.state.assignmentRevision + 1;
    if (c.req.path.endsWith("/prepare")) {
      const barrier = new Barrier(crypto.randomUUID(), deps.state.showRevision, deps.state.transportRevision, request.deviceIds);
      deps.preparations.start("assignment", barrier);
      deps.preparations.assignment = { preparationId: barrier.preparationId, assignmentRevision,
        mapRevision: request.mapRevision, channelId: request.channelId, deviceIds: [...request.deviceIds].sort((a, b) => a - b) };
      for (const id of request.deviceIds) if (!deps.state.readinessOf(id)?.connected) barrier.exclude(id, "disconnected");
      await deps.connections.sendEachToParticipants(request.deviceIds, deviceId => JSON.stringify({
        ...envelope(deps.clock), type: "assignment.prepare", revision: deps.state.revision,
        payload: { preparationId: barrier.preparationId, assignment: { deviceId, channelId: request.channelId, assignmentRevision, mapRevision: request.mapRevision } },
      }));
      const ack = { ...accepted(deps.clock, request.commandId, deps.state.assignmentRevision), preparationId: barrier.preparationId };
      deps.commands.remember(request.commandId, ack);
      return c.json(ack);
    }
    const barrier = deps.preparations.current("assignment");
    const preparation = deps.preparations.assignment;
    const live = deps.state.transport.status === "playing" || deps.state.pendingActions.some(action => action.domain === "transport" && action.transport.status === "playing");
    // Silent routing is durable even for offline phones. A live switch can only admit phones
    // that explicitly verified the new channel for this exact selection and show revision.
    if (request.preparationId || (live && request.channelId !== null)) {
      if (!barrier || !preparation || request.preparationId !== barrier.preparationId
        || preparation.assignmentRevision !== assignmentRevision || barrier.showRevision !== deps.state.showRevision
        || preparation.mapRevision !== request.mapRevision || preparation.channelId !== request.channelId
        || JSON.stringify(preparation.deviceIds) !== JSON.stringify([...request.deviceIds].sort((a, b) => a - b))) {
        return c.json(apiError("NOT_PREPARED", "Prepare this selection and channel before a live assignment."), 409);
      }
    }
    const recipients = live && request.channelId !== null ? request.deviceIds.filter(id => barrier!.readyDevices().includes(id)) : request.deviceIds;
    const excluded = request.deviceIds.filter(id => !recipients.includes(id)).map(deviceId => ({ deviceId,
      reason: barrier?.excludedDevices().find(item => item.deviceId === deviceId)?.reason ?? "not acknowledged" }));
    if (!recipients.length) return c.json(apiError("NOBODY_READY", "No selected phone is ready for this channel."), 409);
    const assignments = recipients.map(deviceId => ({
      deviceId, channelId: request.channelId, assignmentRevision, mapRevision: request.mapRevision,
    }));
    const superseded = deps.state.scheduleAssignments({
      commandId: request.commandId, effectiveServerMs: request.effectiveServerMs, assignments,
    });
    await persist();

    // Each phone is told about its own assignment only, in chunks so a thousand-device selection
    // does not block the server while it serializes a thousand payloads.
    const byDevice = new Map(assignments.map(assignment => [assignment.deviceId, assignment]));
    void deps.connections.sendEachToParticipants(recipients, deviceId => JSON.stringify({
      ...envelope(deps.clock), type: "assignment.commit", revision: deps.state.revision,
      effectiveServerMs: request.effectiveServerMs,
      payload: {
        domain: "assignment", commandId: request.commandId, effectiveServerMs: request.effectiveServerMs,
        supersedesCommandId: deps.state.pendingAssignmentFor(deviceId)?.supersedesCommandId ?? null,
        assignments: [byDevice.get(deviceId)],
      },
    }));

    const ack = { ...accepted(deps.clock, request.commandId, assignmentRevision), effectiveServerMs: request.effectiveServerMs,
      ready: recipients.length, excluded, supersededCommandIds: superseded };
    deps.commands.remember(request.commandId, ack);
    return c.json(ack);
  });

  app.post("/api/mix", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Mix control requires the operator secret."), 401);
    }
    const body = MixRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("INVALID_REQUEST", "Mix request did not match the protocol v1 schema."), 400);
    const request = body.data;
    const guard = guardCommand(deps, request);
    if (guard) return c.json(guard.body, guard.status);

    const replayed = deps.commands.get<unknown>(request.commandId);
    if (replayed) return c.json(replayed);

    const now = deps.clock.nowServerMs();
    deps.state.applyDue(now);
    if (request.expectedRevision !== deps.state.mixRevision) {
      return c.json(apiError("REVISION_CONFLICT", `Mix is at revision ${deps.state.mixRevision}; reload before changing it.`), 409);
    }
    const channelIds = request.channels.map(channel => channel.channelId);
    if (new Set(channelIds).size !== channelIds.length || channelIds.length !== deps.state.show.channels.length
      || deps.state.show.channels.some(channel => !channelIds.includes(channel.channelId))) {
      return c.json(apiError("INVALID_MIX", "A mix must contain each current show channel exactly once."), 400);
    }
    const leadTime = leadTimeError(deps, request.effectiveServerMs, now);
    if (leadTime) return c.json(leadTime.body, leadTime.status);

    const mixRevision = deps.state.mixRevision + 1;
    const superseded = deps.state.scheduleMix({
      domain: "mix", commandId: request.commandId, effectiveServerMs: request.effectiveServerMs,
      supersedesCommandId: null, mixRevision, masterGain: request.masterGain, channels: request.channels,
    });
    deps.connections.sendToParticipants(deps.state.connectedDeviceIds(), JSON.stringify({
      ...envelope(deps.clock), type: "mix.commit", revision: deps.state.revision,
      effectiveServerMs: request.effectiveServerMs,
      payload: {
        domain: "mix", commandId: request.commandId, effectiveServerMs: request.effectiveServerMs,
        supersedesCommandId: superseded, mixRevision, masterGain: request.masterGain, channels: request.channels,
      },
    }));

    const ack = accepted(deps.clock, request.commandId, mixRevision);
    deps.commands.remember(request.commandId, ack);
    return c.json(ack);
  });

  app.all("/api/*", c => c.json(apiError(
    "NOT_IMPLEMENTED", "That API route is not implemented by the sync-control service.",
  ), 501));
  return app;
}
