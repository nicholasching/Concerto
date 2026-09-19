import { Hono } from "hono";
import { cors } from "hono/cors";
import { ApiError } from "@orchestra/contracts";

export function createApp() {
  const app = new Hono();
  app.use("/api/*", cors({ origin: ["http://localhost:3000", "http://localhost:3001"] }));
  app.get("/api/health", c => c.json({ service: "audience-orchestra-control", protocolVersion: 1, implementation: "foundation" }));
  app.get("/api/foundation", c => c.json({
    status: "scaffold", owner: "sync-control", implemented: ["health", "foundation-info"],
    next: ["authenticated registry", "clock WebSocket", "routing", "scheduled commands", "worker adapter"],
  }));
  app.all("/api/*", c => c.json(ApiError.parse({ protocolVersion: 1, error: {
    code: "NOT_IMPLEMENTED", message: "Team 1 owns this endpoint; this foundation does not implement concert control.", retryable: false, owner: "sync-control",
  } }), 501));
  return app;
}
