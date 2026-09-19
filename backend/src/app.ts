import { mkdir, writeFile } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  ApiError, AssignmentRequest, CalibrationArmRequest, CalibrationCreateRequest, CalibrationManifest, CalibrationRun,
  CommandAccepted, CommitMapRequest, CreateJobRequest, JobProgress, JoinRequest, JoinResponse, MixRequest,
  PanicRequest, PROTOCOL_VERSION,
  SaveShowRequest, Track, TransportRequest,
} from "@orchestra/contracts";
import type { AssetStore } from "./assets";
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

export const DEFAULT_LEAD_TIME_MS = 3000;

const numeric = z.coerce.number();
const CameraUploadQuery = z.object({
  commandId: z.string().min(1).max(160),
  cameraId: z.string().min(1).max(160),
  primaryColumn: z.enum(["left", "center", "right"]),
  rotationDegrees: z.coerce.number().int().refine(value => [0, 90, 180, 270].includes(value), "unsupported rotation"),
  byteSize: numeric.int().positive(),
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
  byteSize: numeric.int().positive(),
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
  const persist = () =>
    deps.store.save(deps.registry.toCheckpoint(
      deps.clock.sessionId, deps.state.durableShow,
      deps.state.mapRevision > 0 ? deps.state.audienceMap : null,
      deps.state.lastCommittedRunTag,
    ));
  app.use("/api/*", cors({ origin: ["http://localhost:3000", "http://localhost:3001"] }));
  app.get("/api/health", c => c.json({
    service: "audience-orchestra-control", protocolVersion: 1, implementation: "sync-control",
  }));
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

    const outcome = deps.registry.join(body.data.resumeToken, deps.clock.nowServerMs());
    if (!outcome.ok) {
      return outcome.code === "CAPACITY_REACHED"
        ? c.json(apiError("CAPACITY_REACHED", `Session is full at ${deps.registry.size} devices.`), 503)
        : c.json(apiError("INVALID_RESUME_TOKEN", "Resume token is not valid for this session."), 401);
    }
    // A newly allocated identity is durable before the client is told it owns one.
    if (outcome.allocated) await persist();
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
  app.get("/api/sessions/:sessionId/snapshot", c => {
    if (c.req.param("sessionId") !== deps.clock.sessionId) {
      return c.json(apiError("WRONG_SESSION", "This server is not serving that concert session."), 404);
    }
    if (matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(deps.state.adminSnapshot(deps.clock));
    }
    const resumeToken = c.req.header("x-resume-token");
    const deviceId = resumeToken === undefined ? null : deps.registry.authenticate(resumeToken);
    if (deviceId === null) {
      return c.json(apiError("UNAUTHORIZED", "Provide a valid resume token or the operator secret."), 401);
    }
    const snapshot = deps.state.participantSnapshot(deviceId, deps.clock);
    if (!snapshot) return c.json(apiError("UNKNOWN_DEVICE", "This device is not registered in the current session."), 404);
    return c.json(snapshot);
  });

  app.put("/api/show", async c => {
    if (!matchesOperatorSecret(c.req.header("x-operator-secret"), deps.operatorSecret)) {
      return c.json(apiError("UNAUTHORIZED", "Saving a show requires the operator secret."), 401);
    }
    const body = SaveShowRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("INVALID_REQUEST", "Show request did not match the protocol v1 schema."), 400);
    if (body.data.sessionId !== deps.clock.sessionId) {
      return c.json(apiError("WRONG_SESSION", "This server is not serving that concert session."), 404);
    }

    // Replay before validation: a retry of a command that already succeeded returns its original
    // result even though the revision it expected has since moved on.
    const replayed = deps.commands.get<unknown>(body.data.commandId);
    if (replayed) return c.json(replayed);

    if (deps.state.transport.status !== "stopped") {
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
    if (request.expectedRevision !== deps.state.transport.transportRevision) {
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
        crypto.randomUUID(), deps.state.showRevision, deps.state.transport.transportRevision,
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
        || barrier.transportRevision !== deps.state.transport.transportRevision) {
        return c.json(apiError("NOT_PREPARED", "Prepare this show and transport revision before starting playback."), 409);
      }
      if (barrier.readyDevices().length === 0) {
        return c.json(apiError("NOBODY_READY", "No device has acknowledged this preparation."), 409);
      }
    }

    const transport = nextTransport({
      current: deps.state.transport, action: request.action, showRevision: deps.state.showRevision,
      positionMs: request.action === "play" || request.action === "seek"
        ? request.positionMs
        : positionAt(deps.state.transport, request.effectiveServerMs),
      effectiveServerMs: request.effectiveServerMs,
    });

    // A deliberate transport command is how an operator comes back from a panic.
    deps.lease.resume();
    const superseded = deps.state.scheduleTransport({
      domain: "transport", commandId: request.commandId, effectiveServerMs: request.effectiveServerMs,
      supersedesCommandId: null, transport,
    });
    const recipients = request.action === "play" && barrier ? barrier.readyDevices() : deps.state.connectedDeviceIds();
    deps.connections.sendToParticipants(recipients, JSON.stringify({
      ...envelope(deps.clock), type: "transport.commit", revision: deps.state.revision,
      effectiveServerMs: request.effectiveServerMs,
      payload: { domain: "transport", commandId: request.commandId, effectiveServerMs: request.effectiveServerMs, supersedesCommandId: superseded, transport },
    }));
    if (request.action !== "play") deps.preparations.clear("transport");
    const ack = accepted(deps.clock, request.commandId, transport.transportRevision);
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
    const written = await deps.assets.write(trackId, body);
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
    deps.preparations.start("calibration", barrier);
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
    deps.commands.remember(request.commandId, ack);
    return c.json({ ...ack, excluded: barrier.excludedDevices(), ready: barrier.readyDevices().length });
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
    const written = await deps.uploads.write(uploadId, body);
    if (written.byteSize !== query.data.byteSize) {
      await deps.uploads.discard(uploadId);
      return c.json(apiError(
        "TRUNCATED_UPLOAD", `Expected ${query.data.byteSize} bytes and received ${written.byteSize}.`, true,
      ), 400);
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
      videoPath: deps.uploads.path(upload!.uploadId)!, sha256: upload!.sha256,
      rotationDegrees: upload!.rotationDegrees,
      exclusionRois: upload!.exclusionRois, anchors: upload!.anchors,
    }));
    const manifest = CalibrationManifest.parse({ ...run.plan, startServerMs: run.startServerMs, cameras });

    const jobId = crypto.randomUUID();
    const manifestPath = joinPath(deps.jobWorkspace, `${jobId}.manifest.json`);
    const outputPath = joinPath(deps.jobWorkspace, `${jobId}.result.json`);
    await mkdir(deps.jobWorkspace, { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    deps.calibrations.setStatus(run.plan.runId, "processing");
    const record = deps.jobs.enqueue({ jobId, runId: run.plan.runId, manifestPath, outputPath, manifest });
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

    // Re-check identity at commit, not only when the job finished: this is the last point before
    // the result changes where the operator believes every phone is sitting.
    const cameras = [...run.uploads.values()].map(upload => ({ cameraId: upload.cameraId, sha256: upload.sha256 }));
    const mismatch = identityMismatch(job.result, {
      ...run.plan, startServerMs: run.startServerMs ?? 0,
      cameras: cameras.map(camera => ({
        ...camera, primaryColumn: "left" as const, videoPath: "", rotationDegrees: 0 as const,
        exclusionRois: [], anchors: null,
      })),
    });
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

    const ack = accepted(deps.clock, body.data.commandId, deps.state.transport.transportRevision);
    deps.commands.remember(body.data.commandId, ack);
    return c.json(ack);
  });

  app.post("/api/assignments", async c => {
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
    const assignments = request.deviceIds.map(deviceId => ({
      deviceId, channelId: request.channelId, assignmentRevision, mapRevision: request.mapRevision,
    }));
    const superseded = deps.state.scheduleAssignments({
      commandId: request.commandId, effectiveServerMs: request.effectiveServerMs, assignments,
    });

    // Each phone is told about its own assignment only, in chunks so a thousand-device selection
    // does not block the server while it serializes a thousand payloads.
    const byDevice = new Map(assignments.map(assignment => [assignment.deviceId, assignment]));
    void deps.connections.sendEachToParticipants(request.deviceIds, deviceId => JSON.stringify({
      ...envelope(deps.clock), type: "assignment.commit", revision: deps.state.revision,
      effectiveServerMs: request.effectiveServerMs,
      payload: {
        domain: "assignment", commandId: request.commandId, effectiveServerMs: request.effectiveServerMs,
        supersedesCommandId: deps.state.pendingAssignmentFor(deviceId)?.supersedesCommandId ?? null,
        assignments: [byDevice.get(deviceId)],
      },
    }));

    const ack = accepted(deps.clock, request.commandId, assignmentRevision);
    deps.commands.remember(request.commandId, ack);
    return c.json({ ...ack, supersededCommandIds: superseded });
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
