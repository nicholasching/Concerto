import { createApp } from "./app";
import { matchesOperatorSecret } from "./auth";
import { CheckpointStore, checkpointPath } from "./checkpoint";
import { createServerClock } from "./clock";
import { CommandLog } from "./commands";
import { ConnectionRegistry, OperatorTelemetry } from "./connections";
import { handleClientMessage } from "./messages";
import { DeviceRegistry } from "./registry";
import { JOIN_LIMIT, RateLimiter } from "./rate-limit";
import { SessionState } from "./state";

type SocketData = { role: "participant"; deviceId: number } | { role: "operator" };

const port = Number(process.env.PORT ?? 8080);
const clock = createServerClock();
const registry = new DeviceRegistry();
const state = new SessionState();
const commands = new CommandLog();
const store = new CheckpointStore(checkpointPath());
const joins = new RateLimiter(JOIN_LIMIT.capacity, JOIN_LIMIT.refillPerSecond, clock.nowServerMs);
const connections = new ConnectionRegistry();
const telemetry = new OperatorTelemetry();

const restored = await store.read();
if (restored) {
  if (restored.sessionId !== clock.sessionId) {
    throw new Error(`Checkpoint belongs to session ${restored.sessionId}, not ${clock.sessionId}.`);
  }
  registry.restore(restored);
  for (const device of restored.devices) state.register(device.deviceId);
  if (restored.show) state.restoreShow(restored.show);
}
if (!process.env.OPERATOR_SECRET) {
  console.warn("OPERATOR_SECRET is unset: every operator request will be refused.");
}

const app = createApp({ clock, registry, store, joins, state, commands, operatorSecret: process.env.OPERATOR_SECRET });

const server = Bun.serve<SocketData, string>({
  hostname: process.env.HOST ?? "127.0.0.1",
  port,
  fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") return app.fetch(request);

    const operatorSecret = url.searchParams.get("operatorSecret");
    if (operatorSecret !== null) {
      if (!matchesOperatorSecret(operatorSecret)) return new Response("Invalid operator secret.", { status: 401 });
      return server.upgrade(request, { data: { role: "operator" } })
        ? undefined
        : new Response("Expected a WebSocket upgrade.", { status: 426 });
    }

    const resumeToken = url.searchParams.get("resumeToken");
    const deviceId = resumeToken === null ? null : registry.authenticate(resumeToken);
    if (deviceId === null) return new Response("Join this session before opening a socket.", { status: 401 });
    return server.upgrade(request, { data: { role: "participant", deviceId } })
      ? undefined
      : new Response("Expected a WebSocket upgrade.", { status: 426 });
  },
  websocket: {
    open(ws) {
      if (ws.data.role === "operator") return connections.addOperator(ws);
      connections.bindParticipant(ws.data.deviceId, ws);
      state.setConnected(ws.data.deviceId, true);
      telemetry.mark();
    },
    close(ws) {
      if (ws.data.role === "operator") return connections.removeOperator(ws);
      if (!connections.releaseParticipant(ws.data.deviceId, ws)) return;
      state.setConnected(ws.data.deviceId, false);
      telemetry.mark();
    },
    message(ws, raw) {
      const receivedServerMs = clock.nowServerMs();
      if (ws.data.role === "operator") return;
      const reply = handleClientMessage({
        raw: String(raw), receivedServerMs, clock, deviceId: ws.data.deviceId, state,
      });
      if (reply.type !== "clock.reply") telemetry.mark();
      ws.send(JSON.stringify(reply));
    },
  },
});

// Coalesced operator updates: state churn from probes and joins never becomes one broadcast
// per event.
setInterval(() => {
  if (connections.operatorCount === 0 || !telemetry.due(clock.nowServerMs())) return;
  connections.broadcastToOperators(JSON.stringify({
    protocolVersion: 1, sessionId: clock.sessionId, serverEpoch: clock.serverEpoch,
    messageId: crypto.randomUUID(), type: "state.snapshot",
    revision: state.revision, payload: state.adminSnapshot(clock),
  }));
}, 100);

console.log(
  `Backend: ${server.url} (session ${clock.sessionId}, epoch ${clock.serverEpoch}, ${registry.size} restored devices)`,
);
