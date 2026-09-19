import { createApp } from "./app";
import { CheckpointStore, checkpointPath } from "./checkpoint";
import { createServerClock, handleClientMessage } from "./clock";
import { DeviceRegistry } from "./registry";
import { JOIN_LIMIT, RateLimiter } from "./rate-limit";

const port = Number(process.env.PORT ?? 8080);
const clock = createServerClock();
const registry = new DeviceRegistry();
const store = new CheckpointStore(checkpointPath());
const joins = new RateLimiter(JOIN_LIMIT.capacity, JOIN_LIMIT.refillPerSecond, clock.nowServerMs);

const restored = await store.read();
if (restored) {
  if (restored.sessionId !== clock.sessionId) {
    throw new Error(`Checkpoint belongs to session ${restored.sessionId}, not ${clock.sessionId}.`);
  }
  registry.restore(restored);
}

const app = createApp({ clock, registry, store, joins });
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
console.log(
  `Backend: ${server.url} (session ${clock.sessionId}, epoch ${clock.serverEpoch}, ${registry.size} restored devices)`,
);
