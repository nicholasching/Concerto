import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  ApiError, AssignmentRequest, CommandAccepted, JoinRequest, JoinResponse, MixRequest, PROTOCOL_VERSION,
  SaveShowRequest, Track, TransportRequest,
} from "@orchestra/contracts";
import type { AssetStore } from "./assets";
import { matchesOperatorSecret } from "./auth";
import { Barrier } from "./barriers";
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
    deps.store.save(deps.registry.toCheckpoint(deps.clock.sessionId, deps.state.durableShow));
  app.use("/api/*", cors({ origin: ["http://localhost:3000", "http://localhost:3001"] }));
  app.get("/api/health", c => c.json({ service: "audience-orchestra-control", protocolVersion: 1, implementation: "foundation" }));
  app.get("/api/foundation", c => c.json({
    status: "in progress", owner: "sync-control",
    implemented: [
      "health", "foundation-info", "clock-websocket", "join-resume", "role-filtered-snapshots",
      "show-save", "prepared-transport-cues", "assignments", "mix",
    ],
    next: ["uploads and jobs", "worker adapter", "map commit", "panic and audio lease", "load harness"],
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

    // Each phone is told about its own assignment only.
    for (const assignment of assignments) {
      deps.connections.sendToParticipants([assignment.deviceId], JSON.stringify({
        ...envelope(deps.clock), type: "assignment.commit", revision: deps.state.revision,
        effectiveServerMs: request.effectiveServerMs,
        payload: {
          domain: "assignment", commandId: request.commandId, effectiveServerMs: request.effectiveServerMs,
          supersedesCommandId: deps.state.pendingAssignmentFor(assignment.deviceId)?.supersedesCommandId ?? null,
          assignments: [assignment],
        },
      }));
    }

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
    "NOT_IMPLEMENTED", "Team 1 owns this endpoint; it is not implemented in this slice.",
  ), 501));
  return app;
}
