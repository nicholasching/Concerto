import { Hono } from "hono";
import { cors } from "hono/cors";
import { ApiError, JoinRequest, JoinResponse, PROTOCOL_VERSION } from "@orchestra/contracts";
import type { ServerClock } from "./clock";
import type { CheckpointStore } from "./checkpoint";
import type { DeviceRegistry } from "./registry";
import type { RateLimiter } from "./rate-limit";

export interface AppDeps {
  clock: ServerClock;
  registry: DeviceRegistry;
  store: CheckpointStore;
  joins: RateLimiter;
}

const apiError = (code: string, message: string, retryable = false) =>
  ApiError.parse({ protocolVersion: PROTOCOL_VERSION, error: { code, message, retryable, owner: "sync-control" } });

export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use("/api/*", cors({ origin: ["http://localhost:3000", "http://localhost:3001"] }));
  app.get("/api/health", c => c.json({ service: "audience-orchestra-control", protocolVersion: 1, implementation: "foundation" }));
  app.get("/api/foundation", c => c.json({
    status: "in progress", owner: "sync-control",
    implemented: ["health", "foundation-info", "clock-websocket", "join-resume"],
    next: ["role-filtered snapshots", "subscriptions", "scheduled commands", "uploads and jobs", "worker adapter"],
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
    if (outcome.allocated) await deps.store.save(deps.registry.toCheckpoint(deps.clock.sessionId));

    return c.json(JoinResponse.parse({
      protocolVersion: PROTOCOL_VERSION,
      sessionId: deps.clock.sessionId,
      serverEpoch: deps.clock.serverEpoch,
      deviceId: outcome.deviceId,
      resumeToken: outcome.resumeToken,
      revision: 0,
    }));
  });

  app.all("/api/*", c => c.json(apiError(
    "NOT_IMPLEMENTED", "Team 1 owns this endpoint; it is not implemented in this slice.",
  ), 501));
  return app;
}
