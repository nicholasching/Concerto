import { resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ApiError, ClientMessage, ServerMessage, type ServerMessageData } from "@orchestra/contracts";
import { epochNow } from "@orchestra/sync";
import { createDemoSnapshot, participantSnapshot } from "./index";

// Explicit development harness. Never imported by the backend or production UI.
export function startMockServer(port = 18081, count = 30) {
  const snapshot = createDemoSnapshot(count);
  snapshot.serverEpoch = crypto.randomUUID();
  const envelope = () => ({ protocolVersion: 1 as const, sessionId: snapshot.sessionId, serverEpoch: snapshot.serverEpoch, messageId: crypto.randomUUID() });
  const app = new Hono();
  app.use("*", cors());
  app.use("*", async (c, next) => { await next(); c.header("X-Orchestra-Mock", "1"); });
  app.get("/api/health", c => c.json({ implementation: "mock", synthetic: true }));
  app.get("/__mock__/state", c => c.json(snapshot));
  app.get("/api/sessions/demo/snapshot", c => {
    snapshot.serverMs = epochNow();
    return c.json(c.req.query("role") === "participant" ? participantSnapshot(snapshot, Number(c.req.query("deviceId") ?? 0)) : snapshot);
  });
  app.get("/api/assets/:trackId", async c => {
    const track = snapshot.show.tracks.find(item => item.trackId === c.req.param("trackId"));
    if (!track) return c.notFound();
    return new Response(Bun.file(resolve(import.meta.dir, "../../../fixtures/media", `${track.trackId}.wav`)), { headers: { "Content-Type": "audio/wav", "Access-Control-Allow-Origin": "*", "X-Orchestra-Mock": "1" } });
  });
  app.post("/__mock__/broadcast", async c => {
    const parsed = ServerMessage.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Message failed ServerMessage schema" }, 400);
    if (parsed.data.serverEpoch !== snapshot.serverEpoch || parsed.data.sessionId !== snapshot.sessionId) return c.json({ error: "Use this mock's session/epoch" }, 409);
    server.publish("fixture", JSON.stringify(parsed.data));
    return c.json({ synthetic: true, sent: true });
  });
  app.all("/api/*", c => c.json(ApiError.parse({ protocolVersion: 1, error: { code: "MOCK_NOT_IMPLEMENTED", message: "This fixture harness supports snapshots, assets, probes, and explicit broadcasts only.", retryable: false } }), 501));

  const server = Bun.serve<{ deviceId: number }>({
    hostname: "127.0.0.1", port,
    fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === "/ws") {
        const deviceId = Number(url.searchParams.get("deviceId") ?? 0);
        if (!Number.isInteger(deviceId) || deviceId < 0 || deviceId >= count) return new Response("Unknown fixture device", { status: 400 });
        return server.upgrade(request, { data: { deviceId } }) ? undefined : new Response("Upgrade required", { status: 426 });
      }
      return app.fetch(request, server);
    },
    websocket: {
      open(ws) {
        ws.subscribe("fixture");
        snapshot.serverMs = epochNow();
        ws.send(JSON.stringify(ServerMessage.parse({ ...envelope(), type: "state.snapshot", revision: snapshot.revision, payload: participantSnapshot(snapshot, ws.data.deviceId) })));
      },
      message(ws, raw) {
        const t1 = epochNow();
        let message: ReturnType<typeof ClientMessage.parse>;
        try { message = ClientMessage.parse(JSON.parse(raw.toString())); } catch {
          const error: ServerMessageData = { ...envelope(), type: "error", payload: { protocolVersion: 1, error: { code: "INVALID_MESSAGE", message: "ClientMessage validation failed", retryable: false } } };
          ws.send(JSON.stringify(error)); return;
        }
        if (message.sessionId !== snapshot.sessionId || message.serverEpoch !== snapshot.serverEpoch) { ws.close(1008, "Wrong session/epoch"); return; }
        if (message.type === "clock.probe") ws.send(JSON.stringify(ServerMessage.parse({ ...envelope(), type: "clock.reply", payload: { ...message.payload, t1, t2: epochNow() } })));
      },
    },
  });
  return server;
}
