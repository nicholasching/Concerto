import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  ApiError, CommandAccepted, JoinRequest, JoinResponse, PROTOCOL_VERSION, SaveShowRequest,
} from "@orchestra/contracts";
import { matchesOperatorSecret } from "./auth";
import type { ServerClock } from "./clock";
import type { CheckpointStore } from "./checkpoint";
import type { CommandLog } from "./commands";
import type { DeviceRegistry } from "./registry";
import type { RateLimiter } from "./rate-limit";
import type { SessionState } from "./state";

export interface AppDeps {
  clock: ServerClock;
  registry: DeviceRegistry;
  store: CheckpointStore;
  joins: RateLimiter;
  state: SessionState;
  commands: CommandLog;
  operatorSecret?: string;
}

const apiError = (code: string, message: string, retryable = false) =>
  ApiError.parse({ protocolVersion: PROTOCOL_VERSION, error: { code, message, retryable, owner: "sync-control" } });

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
    const accepted = CommandAccepted.parse({
      protocolVersion: PROTOCOL_VERSION,
      sessionId: deps.clock.sessionId,
      serverEpoch: deps.clock.serverEpoch,
      commandId: body.data.commandId,
      revision: saved.showRevision,
    });
    deps.commands.remember(body.data.commandId, accepted);
    return c.json(accepted);
  });

  app.all("/api/*", c => c.json(apiError(
    "NOT_IMPLEMENTED", "Team 1 owns this endpoint; it is not implemented in this slice.",
  ), 501));
  return app;
}
