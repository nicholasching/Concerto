import { createApp } from "./app";
import { createServerClock, handleClientMessage } from "./clock";

const port = Number(process.env.PORT ?? 8080);
const clock = createServerClock();
const app = createApp();

const server = Bun.serve({
  hostname: process.env.HOST ?? "127.0.0.1",
  port,
  fetch(request, server) {
    if (new URL(request.url).pathname === "/ws") {
      return server.upgrade(request) ? undefined : new Response("Expected a WebSocket upgrade.", { status: 426 });
    }
    return app.fetch(request);
  },
  websocket: {
    message(ws, raw) {
      const receivedServerMs = clock.nowServerMs();
      ws.send(JSON.stringify(handleClientMessage({ raw: String(raw), receivedServerMs, clock })));
    },
  },
});
console.log(`Backend: ${server.url} (session ${clock.sessionId}, epoch ${clock.serverEpoch})`);
