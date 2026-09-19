import { resolve } from "node:path";
import type { ServerWebSocket } from "bun";
import { ApiError, ClientMessage, JoinRequest, JoinResponse, ServerMessage, type ParticipantSnapshotData, type ServerMessageData } from "@orchestra/contracts";
import { createDemoSnapshot, participantSnapshot } from "@orchestra/testkit";

// SYNTHETIC Team 2 harness: join/resume, token-bound sockets and test controls.
// Never imported by production code. Binds to loopback only.
export const REPLACED_CLOSE_CODE = 4001;
// Same monotonic-backed clock as @orchestra/sync epochNow, which tools/ can't resolve outside the workspaces.
const epochNow = () => performance.timeOrigin + performance.now();

interface SocketData { deviceId: number }
interface CalibrationRecord { runId: string; runTag: number; preparationId: string; participantIds: number[]; ready: number[]; notReady: { deviceId: number; reason: string | null }[]; startServerMs: number | null; results: { deviceId: number; completed: boolean; reason: string | null; maxFrameLatenessMs: number }[] }
type TransportData = ParticipantSnapshotData["transport"];
interface ReadyRecord { type: string; deviceId: number; preparationId: string; ready: boolean; reason: string | null }
const LEASE_EVERY_MS = 3000;
const LEASE_LENGTH_MS = 10_000;
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
  const readies: ReadyRecord[] = [];
  let leasePaused = false;
  let mixRevision = 0;
  let masterGain = 1;
  let commandCount = 0;

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

  const broadcast = (message: ServerMessageData, deviceIds: Iterable<number> = sockets.keys()) => {
    const text = JSON.stringify(ServerMessage.parse(message));
    for (const id of deviceIds) sockets.get(id)?.send(text);
  };
  const sendLease = (ids?: Iterable<number>) => {
    if (!leasePaused) broadcast({ ...envelope(), type: "lease.renew", payload: { expiresServerMs: epochNow() + LEASE_LENGTH_MS } }, ids);
  };
  const leaseTimer = setInterval(() => sendLease(), LEASE_EVERY_MS);
  leaseTimer.unref?.();

  // A committed change is pending until its time, then becomes the effective snapshot state.
  function schedule(action: ParticipantSnapshotData["pendingActions"][number], apply: () => void) {
    snapshot.pendingActions = snapshot.pendingActions.filter(item => item.domain !== action.domain || action.domain === "assignment");
    snapshot.pendingActions.push(action);
    snapshot.revision += 1;
    const timer = setTimeout(() => {
      snapshot.pendingActions = snapshot.pendingActions.filter(item => item !== action);
      apply();
      snapshot.revision += 1;
    }, Math.max(0, action.effectiveServerMs - epochNow()));
    timer.unref?.();
  }
  const positionAt = (transport: TransportData, at: number) =>
    transport.status === "playing" ? transport.positionMs + Math.max(0, at - transport.startServerMs) : transport.positionMs;

  function assign(deviceId: number, channelId: string | null, leadMs: number, readyWaitMs: number) {
    const current = snapshot.assignments.find(item => item.deviceId === deviceId);
    if (!current || deviceId >= nextDeviceId) return apiError(404, "UNKNOWN_DEVICE", `Device ${deviceId} has not joined`);
    if (channelId !== null && !snapshot.show.channels.some(channel => channel.channelId === channelId)) return apiError(400, "UNKNOWN_CHANNEL", `No channel ${channelId}`);
    const assignment = { ...current, channelId, assignmentRevision: current.assignmentRevision + 1 };
    const preparationId = `mock-assign-${++commandCount}`;
    broadcast({ ...envelope(), type: "assignment.prepare", revision: snapshot.revision, payload: { preparationId, assignment } }, [deviceId]);
    setTimeout(() => {
      const effectiveServerMs = epochNow() + leadMs;
      const action = { commandId: preparationId, effectiveServerMs, supersedesCommandId: null, domain: "assignment" as const, assignments: [assignment] };
      schedule(action, () => { Object.assign(current, assignment); });
      broadcast({ ...envelope(), type: "assignment.commit", revision: snapshot.revision, effectiveServerMs, payload: action }, [deviceId]);
    }, readyWaitMs).unref?.();
    return json({ preparationId, assignment });
  }

  function transport(action: string, positionMs: number | null, leadMs: number, readyWaitMs: number) {
    if (!["play", "pause", "seek", "stop"].includes(action)) return apiError(400, "BAD_ACTION", "action must be play, pause, seek or stop");
    const previous = snapshot.pendingActions.find(item => item.domain === "transport")?.transport ?? snapshot.transport;
    const transportRevision = previous.transportRevision + 1;
    const showRevision = snapshot.show.showRevision;
    const preparationId = `mock-transport-${++commandCount}`;
    broadcast({ ...envelope(), type: "transport.prepare", revision: snapshot.revision, payload: { preparationId, showRevision, transportRevision } });
    setTimeout(() => {
      const effectiveServerMs = epochNow() + leadMs;
      const here = positionAt(previous, effectiveServerMs);
      const next: TransportData =
        action === "stop" ? { status: "stopped", transportRevision, showRevision, positionMs: 0, startServerMs: null }
        : action === "pause" ? { status: "paused", transportRevision, showRevision, positionMs: here, startServerMs: null }
        : action === "seek" && previous.status !== "playing" ? { status: "paused", transportRevision, showRevision, positionMs: positionMs ?? 0, startServerMs: null }
        : { status: "playing", transportRevision, showRevision, positionMs: positionMs ?? (action === "play" ? here : 0), startServerMs: effectiveServerMs };
      const pending = { commandId: preparationId, effectiveServerMs, supersedesCommandId: null, domain: "transport" as const, transport: next };
      schedule(pending, () => { snapshot.transport = next; });
      broadcast({ ...envelope(), type: "transport.commit", revision: snapshot.revision, effectiveServerMs, payload: pending });
    }, readyWaitMs).unref?.();
    return json({ preparationId, transportRevision });
  }

  function mix(params: URLSearchParams, leadMs: number) {
    const flag = (name: string) => new Set((params.get(name) ?? "").split(",").filter(Boolean));
    const mute = flag("mute"), unmute = flag("unmute"), solo = flag("solo"), unsolo = flag("unsolo");
    if (params.has("masterGain")) masterGain = Math.min(1, Math.max(0, Number(params.get("masterGain"))));
    const channels = snapshot.show.channels.map(channel => ({
      ...channel,
      mute: mute.has(channel.channelId) ? true : unmute.has(channel.channelId) ? false : channel.mute,
      solo: solo.has(channel.channelId) ? true : unsolo.has(channel.channelId) ? false : channel.solo,
    }));
    const effectiveServerMs = epochNow() + leadMs;
    const action = { commandId: `mock-mix-${++commandCount}`, effectiveServerMs, supersedesCommandId: null, domain: "mix" as const, mixRevision: ++mixRevision, masterGain, channels };
    schedule(action, () => { snapshot.show.channels = channels; });
    broadcast({ ...envelope(), type: "mix.commit", revision: snapshot.revision, effectiveServerMs, payload: action });
    return json({ mixRevision, masterGain, channels: channels.map(({ channelId, mute: m, solo: s }) => ({ channelId, mute: m, solo: s })) });
  }

  function panic() {
    const commandId = `mock-panic-${++commandCount}`;
    snapshot.pendingActions = [];
    const revision = Math.max(snapshot.transport.transportRevision, 0) + 1;
    snapshot.transport = { status: "stopped", transportRevision: revision, showRevision: snapshot.show.showRevision, positionMs: 0, startServerMs: null };
    snapshot.revision += 1;
    broadcast({ ...envelope(), type: "panic", revision: snapshot.revision, payload: { commandId } });
    return json({ commandId, transportRevision: revision });
  }

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
        const deviceId = tokens.get(url.searchParams.get("resumeToken") ?? "");
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
      const lead = Number(url.searchParams.get("leadMs") ?? 2000);
      const wait = Number(url.searchParams.get("readyWaitMs") ?? 500);
      if (request.method === "POST" && url.pathname === "/__mock__/assign") {
        const channel = url.searchParams.get("channelId");
        return assign(Number(url.searchParams.get("deviceId") ?? 0), channel === null || channel === "none" ? null : channel, lead, wait);
      }
      if (request.method === "POST" && url.pathname === "/__mock__/transport") {
        const position = url.searchParams.get("positionMs");
        return transport(url.searchParams.get("action") ?? "", position === null ? null : Number(position), lead, wait);
      }
      if (request.method === "POST" && url.pathname === "/__mock__/mix") return mix(url.searchParams, lead);
      if (request.method === "POST" && url.pathname === "/__mock__/panic") return panic();
      if (request.method === "POST" && url.pathname === "/__mock__/lease") {
        leasePaused = url.searchParams.get("paused") === "1";
        if (!leasePaused) sendLease();
        return json({ leasePaused });
      }
      if (request.method === "POST" && url.pathname === "/__mock__/assets") {
        const preparationId = `mock-assets-${++commandCount}`;
        broadcast({ ...envelope(), type: "assets.prepare", revision: snapshot.revision, payload: { preparationId, show: snapshot.show } });
        return json({ preparationId });
      }
      if (request.method === "GET" && url.pathname === "/__mock__/playback") {
        return json({ transport: snapshot.transport, masterGain, assignments: snapshot.assignments.filter(item => item.deviceId < nextDeviceId), pendingActions: snapshot.pendingActions, readies, leasePaused });
      }
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
        sendLease([ws.data.deviceId]);
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
        if (message.type === "assets.ready" || message.type === "assignment.ready" || message.type === "transport.ready") {
          const { preparationId, ready, reason } = message.payload;
          readies.push({ type: message.type, deviceId: ws.data.deviceId, preparationId, ready, reason });
          log(`device ${ws.data.deviceId}: ${message.type} ${preparationId} ${ready ? "ready" : `not ready (${reason})`}`);
        }
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
