import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  ApiError, CommandAccepted, JoinRequest, JoinResponse, PROTOCOL_VERSION, SaveShowRequest, TransportRequest,
} from "@orchestra/contracts";
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

export interface AppDeps {
  clock: ServerClock;
  registry: DeviceRegistry;
  store: CheckpointStore;
  joins: RateLimiter;
  state: SessionState;
  commands: CommandLog;
  connections: ConnectionRegistry;
  preparations: Preparations;
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

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const persist = () =>
    deps.store.save(deps.registry.toCheckpoint(deps.clock.sessionId, deps.state.durableShow));
  app.use("/api/*", cors({ origin: ["http://localhost:3000", "http://localhost:3001"] }));
  app.get("/api/health", c => c.json({ service: "audience-orchestra-control", protocolVersion: 1, implementation: "foundation" }));
  app.get("/api/foundation", c => c.json({
    status: "in progress", owner: "sync-control",
    implemented: ["health", "foundation-info", "clock-websocket", "join-resume", "role-filtered-snapshots"],
    next: ["subscriptions", "scheduled commands", "uploads and jobs", "worker adapter"],
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
    if (request.sessionId !== deps.clock.sessionId) {
      return c.json(apiError("WRONG_SESSION", "This server is not serving that concert session."), 404);
    }
    // A command minted under a previous epoch was scheduled against a clock origin that no
    // longer exists; its effective time means nothing now.
    if (request.serverEpoch !== deps.clock.serverEpoch) {
      return c.json(apiError("STALE_EPOCH", "The server restarted; resynchronize and reissue this command.", true), 409);
    }

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

    const leadTimeMs = deps.leadTimeMs ?? DEFAULT_LEAD_TIME_MS;
    if (request.effectiveServerMs < now + leadTimeMs) {
      return c.json(apiError(
        "INSUFFICIENT_LEAD_TIME",
        `A cue must be at least ${leadTimeMs} ms in the future; phones need time to schedule it.`,
      ), 409);
    }

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

    const superseded = deps.state.schedule({
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

  app.all("/api/*", c => c.json(apiError(
    "NOT_IMPLEMENTED", "Team 1 owns this endpoint; it is not implemented in this slice.",
  ), 501));
  return app;
}
