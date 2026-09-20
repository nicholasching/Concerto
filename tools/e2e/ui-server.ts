// Isolated browser verification: start built Next apps on 13010/13011, then use localhost:18090.
// Uses production backend modules and bundles, but disposable test state and original test tones.
import { resolve } from "node:path";
import { DEFAULT_CALIBRATION_PALETTE, Show } from "@orchestra/contracts";
import { createApp } from "../../backend/src/app";
import { AssetStore } from "../../backend/src/assets";
import { CalibrationRuns } from "../../backend/src/calibration";
import { CheckpointStore } from "../../backend/src/checkpoint";
import { createServerClock } from "../../backend/src/clock";
import { CommandLog } from "../../backend/src/commands";
import { ConnectionRegistry } from "../../backend/src/connections";
import { JobRunner } from "../../backend/src/jobs";
import { AudioLease } from "../../backend/src/lease";
import { handleClientMessage } from "../../backend/src/messages";
import { Preparations } from "../../backend/src/preparations";
import { RateLimiter } from "../../backend/src/rate-limit";
import { DeviceRegistry } from "../../backend/src/registry";
import { SessionState } from "../../backend/src/state";

const directory = resolve("runtime/ui-test", crypto.randomUUID());
const clock = createServerClock("dev-session"), state = new SessionState(), registry = new DeviceRegistry();
const connections = new ConnectionRegistry(), preparations = new Preparations(), calibrations = new CalibrationRuns();
const assets = new AssetStore(resolve(directory, "assets"));
const show = Show.parse(await Bun.file("fixtures/show.json").json());
for (const track of show.tracks) await assets.write(track.trackId, Bun.file(`fixtures/media/${track.trackId}.wav`).stream());
state.saveShow(show);
const testDevice = registry.join(undefined, clock.nowServerMs());
if (!testDevice.ok) throw new Error("Could not seed test participant");
state.register(testDevice.deviceId);
const run = calibrations.create({ sessionId: clock.sessionId, serverEpoch: clock.serverEpoch, participantIds: [testDevice.deviceId],
  ...DEFAULT_CALIBRATION_PALETTE });
if (!run.ok) throw new Error("Could not seed an isolated upload run");
calibrations.arm(run.run.plan.runId, clock.nowServerMs() - 20000);
const app = createApp({ clock, state, registry, connections, preparations, calibrations, assets,
  uploads: new AssetStore(resolve(directory, "uploads")), store: new CheckpointStore(resolve(directory, "checkpoint.json")),
  commands: new CommandLog(), jobs: new JobRunner(), lease: new AudioLease(), joins: new RateLimiter(100, 100, clock.nowServerMs),
  operatorSecret: "test-stage", jobWorkspace: resolve(directory, "jobs") });
type Data = { role: "operator" } | { role: "participant"; deviceId: number };
const envelope = () => ({ protocolVersion: 1, sessionId: clock.sessionId, serverEpoch: clock.serverEpoch, messageId: crypto.randomUUID(), type: "state.snapshot", revision: state.revision });
const server = Bun.serve<Data>({ hostname: "127.0.0.1", port: 18090, async fetch(request, server) {
  const url = new URL(request.url);
  if (url.pathname === "/__test__/complete-map" && request.method === "POST") { state.calibrationStage = "complete"; return Response.json({ stage: "complete" }); }
  if (url.pathname === "/ws" || url.pathname === "/control/ws") {
    const secret = url.searchParams.get("operatorSecret");
    if (secret === "test-stage" && url.pathname === "/control/ws") return server.upgrade(request, { data: { role: "operator" } }) ? undefined : new Response("Upgrade required", { status: 426 });
    const deviceId = registry.authenticate(url.searchParams.get("resumeToken") ?? "");
    if (deviceId === null) return new Response("Unauthorized", { status: 401 });
    return server.upgrade(request, { data: { role: "participant", deviceId } }) ? undefined : new Response("Upgrade required", { status: 426 });
  }
  if (url.pathname.startsWith("/control/")) { url.pathname = url.pathname.slice("/control".length); return app.fetch(new Request(url, request)); }
  if (url.pathname.startsWith("/api/")) return app.fetch(request);
  const origin = url.pathname.startsWith("/admin") ? "http://127.0.0.1:13011" : "http://127.0.0.1:13010";
  const headers = new Headers(request.headers); headers.delete("host"); headers.set("accept-encoding", "identity");
  const response = await fetch(`${origin}${url.pathname}${url.search}`, { headers, redirect: "manual" });
  // Bun fetch decompresses upstream responses; do not advertise compressed bytes again.
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding"); responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding"); responseHeaders.delete("connection");
  return new Response(response.body, { status: response.status, headers: responseHeaders });
}, websocket: {
  open(ws) {
    if (ws.data.role === "operator") { connections.addOperator(ws); ws.send(JSON.stringify({ ...envelope(), payload: state.adminSnapshot(clock) })); }
    else { connections.bindParticipant(ws.data.deviceId, ws); state.setConnected(ws.data.deviceId, true); ws.send(JSON.stringify({ ...envelope(), payload: state.participantSnapshot(ws.data.deviceId, clock) })); }
  },
  close(ws) { if (ws.data.role === "operator") connections.removeOperator(ws); else if (connections.releaseParticipant(ws.data.deviceId, ws)) state.setConnected(ws.data.deviceId, false); },
  message(ws, raw) {
    if (ws.data.role === "operator" && JSON.parse(String(raw)).type !== "clock.probe") return;
    if (ws.data.role === "participant" && connections.participantSocket(ws.data.deviceId) !== ws) return;
    ws.send(JSON.stringify(handleClientMessage({ raw: String(raw), receivedServerMs: clock.nowServerMs(), clock, state, preparations, calibrations,
      deviceId: ws.data.role === "participant" ? ws.data.deviceId : -1 })));
  },
} });
setInterval(() => {
  connections.broadcastToOperators(JSON.stringify({ ...envelope(), payload: state.adminSnapshot(clock) }));
  for (const id of state.connectedDeviceIds()) connections.sendToParticipants([id], JSON.stringify({ ...envelope(), payload: state.participantSnapshot(id, clock) }));
}, 1000);
console.log(`Isolated UI test: ${server.url}, password test-stage. Disposable state: ${directory}`);
