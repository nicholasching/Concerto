import { resolve } from "node:path";
import type { ServerWebSocket } from "bun";
import { ApiError, ClientMessage, JoinRequest, JoinResponse, ServerMessage, type ServerMessageData } from "@orchestra/contracts";
import { createDemoSnapshot, participantSnapshot } from "@orchestra/testkit";

// SYNTHETIC Team 2 harness: join/resume, token-bound sockets and test controls.
// Never imported by production code. Binds to loopback only.
export const REPLACED_CLOSE_CODE = 4001;
// Same monotonic-backed clock as @orchestra/sync epochNow, which tools/ can't resolve outside the workspaces.
const epochNow = () => performance.timeOrigin + performance.now();

interface SocketData { deviceId: number }
interface CalibrationRecord { runId: string; runTag: number; preparationId: string; participantIds: number[]; ready: number[]; notReady: { deviceId: number; reason: string | null }[]; startServerMs: number | null; results: { deviceId: number; completed: boolean; reason: string | null; maxFrameLatenessMs: number }[] }
const PALETTE = { paletteVersion: "amber-blue-v1", palette: { zero: "#FFB000", one: "#0066FF", neutral: "#111111" } };

export function startClientDemoServer({ port = 18081, capacity = 30, log = console.log } = {}) {
  const snapshot = createDemoSnapshot(capacity);
  snapshot.serverEpoch = crypto.randomUUID();
  snapshot.devices = snapshot.devices.map(device => ({ ...device, connected: false }));
  const tokens = new Map<string, number>();
  const sockets = new Map<number, ServerWebSocket<SocketData>>();
  let nextDeviceId = 0;
  let lastRunTag = -1;
  const calibrations: CalibrationRecord[] = [];

  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "X-Orchestra-Mock": "1" };
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
  const apiError = (status: number, code: string, message: string, retryable = false) =>
    json(ApiError.parse({ protocolVersion: 1, error: { code, message, retryable } }), status);
  const envelope = () => ({ protocolVersion: 1 as const, sessionId: snapshot.sessionId, serverEpoch: snapshot.serverEpoch, messageId: crypto.randomUUID() });
  const setConnected = (deviceId: number, connected: boolean) => {
    const device = snapshot.devices.find(item => item.deviceId === deviceId);
    if (device) device.connected = connected;
  };
  const sendSnapshot = (ws: ServerWebSocket<SocketData>) => {
    snapshot.serverMs = epochNow();
    ws.send(JSON.stringify(ServerMessage.parse({ ...envelope(), type: "state.snapshot", revision: snapshot.revision, payload: participantSnapshot(snapshot, ws.data.deviceId) })));
  };
  const closeAll = (code: number, reason: string) => { for (const ws of sockets.values()) ws.close(code, reason); };

  // Prepare every connected device, wait for readiness, then arm the ready subset at a common future time.
  function calibrate(leadMs: number, readyWaitMs: number) {
    const participantIds = [...sockets.keys()].sort((a, b) => a - b);
    if (participantIds.length === 0) return apiError(409, "NO_PARTICIPANTS", "No connected devices to calibrate");
    if (lastRunTag >= 255) return apiError(409, "RUN_TAGS_EXHAUSTED", "Start a new session after 256 calibrations");
    const runTag = ++lastRunTag;
    const record: CalibrationRecord = { runId: `mock-run-${runTag}`, runTag, preparationId: `mock-prepare-${runTag}`, participantIds, ready: [], notReady: [], startServerMs: null, results: [] };
    calibrations.push(record);
    const plan = { protocolVersion: 1 as const, sessionId: snapshot.sessionId, serverEpoch: snapshot.serverEpoch, runId: record.runId, runTag, participantIds, packetVersion: "otc-v1" as const, codebookVersion: "hamming16-11-v1" as const, ...PALETTE, symbolMs: 200 as const };
    snapshot.revision += 1;
    const prepare = JSON.stringify(ServerMessage.parse({ ...envelope(), type: "calibration.prepare", revision: snapshot.revision, payload: { preparationId: record.preparationId, plan } }));
    for (const id of participantIds) sockets.get(id)?.send(prepare);
    setTimeout(() => {
      const startServerMs = epochNow() + leadMs;
      record.startServerMs = startServerMs;
      snapshot.revision += 1;
      const arm = JSON.stringify(ServerMessage.parse({ ...envelope(), type: "calibration.arm", revision: snapshot.revision, effectiveServerMs: startServerMs, payload: { preparationId: record.preparationId, run: { ...plan, startServerMs } } }));
      for (const id of record.ready) sockets.get(id)?.send(arm);
    }, readyWaitMs);
    return json({ runId: record.runId, runTag, participantIds });
  }

  async function join(request: Request) {
    const parsed = JoinRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError(400, "INVALID_JOIN", "JoinRequest validation failed");
    let resumeToken = parsed.data.resumeToken;
    let deviceId: number;
    if (resumeToken !== undefined) {
      const known = tokens.get(resumeToken);
      if (known === undefined) return apiError(401, "INVALID_RESUME_TOKEN", "Unknown resume token");
      deviceId = known;
    } else {
      if (nextDeviceId >= capacity) return apiError(409, "SESSION_FULL", `Session capacity ${capacity} reached`);
      deviceId = nextDeviceId++;
      resumeToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      tokens.set(resumeToken, deviceId);
    }
    return json(JoinResponse.parse({ protocolVersion: 1, sessionId: snapshot.sessionId, serverEpoch: snapshot.serverEpoch, deviceId, resumeToken, revision: snapshot.revision }));
  }

  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1", port,
    async fetch(request, server) {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (url.pathname === "/ws") {
        const deviceId = tokens.get(url.searchParams.get("token") ?? "");
        if (deviceId === undefined) return new Response("Unknown token", { status: 401 });
        return server.upgrade(request, { data: { deviceId } }) ? undefined : new Response("Upgrade required", { status: 426 });
      }
      if (request.method === "POST" && url.pathname === `/api/sessions/${snapshot.sessionId}/join`) return join(request);
      const asset = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
      if (request.method === "GET" && asset) {
        const track = snapshot.show.tracks.find(item => item.trackId === asset[1]);
        if (!track) return new Response("Not found", { status: 404, headers: cors });
        return new Response(Bun.file(resolve(import.meta.dir, "../../fixtures/media", `${track.trackId}.wav`)), { headers: { ...cors, "Content-Type": "audio/wav" } });
      }
      if (request.method === "GET" && url.pathname === "/api/health") return json({ implementation: "client-demo mock", synthetic: true });
      if (request.method === "GET" && url.pathname === "/__mock__/devices") {
        return json(snapshot.devices.filter(device => device.deviceId < nextDeviceId));
      }
      if (request.method === "POST" && url.pathname === "/__mock__/calibrate") {
        return calibrate(Number(url.searchParams.get("leadMs") ?? 3000), Number(url.searchParams.get("readyWaitMs") ?? 1000));
      }
      if (request.method === "GET" && url.pathname === "/__mock__/calibration") return json(calibrations);
      if (request.method === "POST" && url.pathname === "/__mock__/drop") { closeAll(1012, "mock drop"); return json({ dropped: true }); }
      if (request.method === "POST" && url.pathname === "/__mock__/restart") {
        snapshot.serverEpoch = crypto.randomUUID();
        closeAll(1012, "mock restart");
        return json({ serverEpoch: snapshot.serverEpoch });
      }
      if (url.pathname.startsWith("/api/")) return apiError(501, "MOCK_NOT_IMPLEMENTED", "Client demo mock supports join, sockets, assets and test controls only.");
      return new Response("Not found", { status: 404, headers: cors });
    },
    websocket: {
      open(ws) {
        const previous = sockets.get(ws.data.deviceId);
        sockets.set(ws.data.deviceId, ws);
        previous?.close(REPLACED_CLOSE_CODE, "replaced");
        setConnected(ws.data.deviceId, true);
        sendSnapshot(ws);
      },
      message(ws, raw) {
        const t1 = epochNow();
        let body: unknown = null;
        try { body = JSON.parse(raw.toString()); } catch { /* validated below */ }
        const parsed = ClientMessage.safeParse(body);
        if (!parsed.success) {
          const error: ServerMessageData = { ...envelope(), type: "error", payload: { protocolVersion: 1, error: { code: "INVALID_MESSAGE", message: "ClientMessage validation failed", retryable: false } } };
          ws.send(JSON.stringify(error));
          return;
        }
        const message = parsed.data;
        if (message.sessionId !== snapshot.sessionId || message.serverEpoch !== snapshot.serverEpoch) { ws.close(1008, "Wrong session/epoch"); return; }
        if (message.type === "clock.probe") ws.send(JSON.stringify(ServerMessage.parse({ ...envelope(), type: "clock.reply", payload: { ...message.payload, t1, t2: epochNow() } })));
        if (message.type === "calibration.ready" || message.type === "calibration.result") {
          const record = calibrations.find(item => item.runId === message.payload.runId);
          if (!record) return;
          if (message.type === "calibration.ready") {
            record.ready = record.ready.filter(id => id !== ws.data.deviceId);
            record.notReady = record.notReady.filter(item => item.deviceId !== ws.data.deviceId);
            if (message.payload.ready) record.ready.push(ws.data.deviceId);
            else record.notReady.push({ deviceId: ws.data.deviceId, reason: message.payload.reason });
          } else {
            const { completed, reason, maxFrameLatenessMs } = message.payload;
            record.results.push({ deviceId: ws.data.deviceId, completed, reason, maxFrameLatenessMs });
            log(`device ${ws.data.deviceId}: calibration ${record.runId} ${completed ? "completed" : `not completed (${reason})`}, max frame lateness ${maxFrameLatenessMs.toFixed(1)} ms`);
          }
        }
        if (message.type === "device.status") {
          if (message.payload.deviceId !== ws.data.deviceId) { ws.close(1008, "Device mismatch"); return; }
          const index = snapshot.devices.findIndex(device => device.deviceId === ws.data.deviceId);
          snapshot.devices[index] = { ...message.payload, connected: true };
          const r = message.payload;
          log(`device ${r.deviceId}: foreground=${r.foreground} clock=${r.clockReady} audio=${r.audioUnlocked} assets=${Object.keys(r.decodedTrackHashes).length}`);
        }
      },
      close(ws) {
        if (sockets.get(ws.data.deviceId) !== ws) return;
        sockets.delete(ws.data.deviceId);
        setConnected(ws.data.deviceId, false);
      },
    },
  });
  return server;
}
