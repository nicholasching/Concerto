import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { ClientMessage, ServerMessage, DEFAULT_CALIBRATION_PALETTE, type ServerMessageData } from "@orchestra/contracts";
import { ClockSync } from "../../packages/sync/src";
import { CalibrationSession } from "../../client-frontend/src/lib/calibration";
import { summarize } from "./metrics";

// Public-origin control/media test, using actual clock + calibration client implementations.
// Timers inject ordered application-layer delay; this is not network packet shaping or
// independent radio clients. It does not play audio, render screens, or reset/save the show.
const base = (process.env.LOAD_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const control = process.env.LOAD_CONTROL_URL ?? base;
const count = Number(process.env.LOAD_CLIENTS ?? 250);
const secret = process.env.OPERATOR_SECRET;
assert(secret, "Set OPERATOR_SECRET in the environment");
assert(Number.isInteger(count) && count > 0 && count <= 250, "1..250 clients required");
const runKey = `stage-load-${Date.now()}`;
const httpMs: Record<string, number[]> = {};
async function request(path: string, init?: RequestInit, operator = false) {
  const start = performance.now();
  const response = await fetch((operator ? control : base) + path, { ...init, signal: AbortSignal.timeout(60000),
    headers: { ...(operator ? { "x-operator-secret": secret! } : {}), ...init?.headers } });
  (httpMs[path.split("?")[0]] ??= []).push(performance.now() - start);
  assert(response.ok, `HTTP ${response.status} on ${path.split("?")[0]}`);
  return response;
}
const info = await (await request("/api/session")).json();
const snapshot = async () => (await request(`/api/sessions/${info.sessionId}/snapshot`, undefined, true)).json();
const before = await snapshot();
assert(!before.calibration, "An existing calibration is active; leave it untouched");
assert.equal(before.transport.status, "stopped", "Do not load-test an active performance");
const showBefore = JSON.stringify(before.show);
const operator = async (path: string, body: object, delayMs = 0) => {
  await Bun.sleep(delayMs);
  return (await request(path, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, sessionId: info.sessionId, serverEpoch: info.serverEpoch,
      commandId: crypto.randomUUID(), expectedRevision: 0, ...body }) }, true)).json();
};
let seed = 20261028;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const clients: Phone[] = [];
let ownedRunId: string | null = null;
let downloads: Promise<void>[] = [];
let sustainedDownloads = false;
let bytesDownloaded = 0, maxConcurrentDownloads = 0, activeDownloads = 0;
const downloadMs: number[] = [], margins: number[] = [], errors: string[] = [];
let deadlineAt = 0;

class Phone {
  socket: WebSocket | null = null;
  token = "";
  id = -1;
  foreground = true;
  forceUnready = false;
  receivedArms = 0;
  acceptedArms = 0;
  probes = 0;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private lastUp = 0;
  private lastDown = 0;
  private groupJitter = new Map<number, number>();
  readonly clock = new ClockSync({ profile: "internet", send: probe => { this.probes++; this.send("clock.probe", probe); } });
  readonly calibration = new CalibrationSession(message => this.delayedSend(message), () => ({
    sessionId: info.sessionId, serverEpoch: info.serverEpoch, deviceId: this.id,
  }));
  constructor(readonly index: number) {}
  private later(callback: () => void, at: number) {
    const timer = setTimeout(() => { this.timers.delete(timer); callback(); }, Math.max(0, at - performance.now()));
    this.timers.add(timer);
  }
  async connect() {
    const joined = await (await request(`/api/sessions/${info.sessionId}/join`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(this.token ? { resumeToken: this.token } : {}) })).json();
    if (this.id >= 0) assert.equal(joined.deviceId, this.id, "Reconnect changed identity");
    this.id = joined.deviceId; this.token = joined.resumeToken;
    const socket = new WebSocket(`${base.replace(/^http/, "ws")}/ws?resumeToken=${encodeURIComponent(this.token)}`);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Socket connect timed out")), 20000);
      socket.onopen = () => { clearTimeout(timeout); resolve(); };
      socket.onerror = () => { clearTimeout(timeout); reject(new Error("Socket connect failed")); };
      socket.onmessage = event => {
        const raw = String(event.data);
        const at = Math.max(this.lastDown, performance.now() + 80 + (this.index % 4) * 80 + random() * 30
          + (random() < 0.02 ? 1000 : 0));
        this.lastDown = at;
        this.later(() => { if (this.socket === socket) this.receive(raw); }, at);
      };
    });
    this.clock.start(info.serverEpoch);
    this.statusTimer = setInterval(() => this.status(), 500);
  }
  send(type: string, payload: unknown) {
    this.delayedSend(ClientMessage.parse({ protocolVersion: 1, sessionId: info.sessionId, serverEpoch: info.serverEpoch,
      messageId: crypto.randomUUID(), type, payload }));
  }
  private delayedSend(message: unknown) {
    const parsed = message as { type: string; payload: { probeGroupId?: number } };
    let jitter = random() * 30;
    if (parsed.type === "clock.probe") {
      const group = parsed.payload.probeGroupId!;
      if (!this.groupJitter.has(group)) this.groupJitter.set(group, random() * 30 + (random() < 0.04 ? 300 : 0));
      jitter = this.groupJitter.get(group)! + random() * 8;
      if (this.groupJitter.size > 200) this.groupJitter.delete(this.groupJitter.keys().next().value!);
    }
    const at = Math.max(this.lastUp, performance.now() + 80 + (this.index % 4) * 80 + jitter);
    this.lastUp = at;
    const socket = this.socket;
    this.later(() => { if (this.socket === socket && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }, at);
  }
  status() {
    const quality = this.clock.quality();
    this.send("device.status", { deviceId: this.id, connected: true, foreground: this.foreground,
      clockReady: !this.forceUnready && quality.ready, clockUncertaintyMs: quality.uncertaintyMs,
      clockSampleAgeMs: quality.sampleAgeMs, audioUnlocked: true, decodedTrackHashes: {} });
  }
  private receive(raw: string) {
    let message: ServerMessageData;
    try { message = ServerMessage.parse(JSON.parse(raw)); } catch { errors.push("Invalid server message"); return; }
    if (message.type === "clock.reply") this.clock.accept({ ...message.payload, serverEpoch: message.serverEpoch });
    if (message.type === "calibration.prepare") this.calibration.onPrepare(message, {
      foreground: this.foreground, clockUsable: !this.forceUnready && this.clock.quality().ready, optedOut: false,
    });
    if (message.type === "calibration.arm") {
      this.receivedArms++;
      margins.push(message.effectiveServerMs - this.clock.nowServerMs());
      if (this.clock.quality().ready) this.calibration.onArm(message, this.clock.nowServerMs());
      if (this.calibration.phase.kind === "armed") this.acceptedArms++;
    }
    if (message.type === "error") errors.push(message.payload.error.code);
  }
  disconnect() {
    this.clock.stop();
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
    this.socket?.close(); this.socket = null;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear(); this.lastUp = 0; this.lastDown = 0;
    this.calibration.abort("disconnected");
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 90000) {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) { if (await check()) return; await Bun.sleep(500); }
  throw new Error("Timed out waiting for load-test condition");
}
async function download(url: string, hash: string, expectedSize: number) {
  const started = performance.now(); activeDownloads++; maxConcurrentDownloads = Math.max(maxConcurrentDownloads, activeDownloads);
  try {
    const response = await request(url, { cache: "no-store" });
    const data = new Uint8Array(await response.arrayBuffer());
    assert.equal(data.byteLength, expectedSize);
    assert.equal(new Bun.CryptoHasher("sha256").update(data).digest("hex"), hash);
    bytesDownloaded += data.byteLength; downloadMs.push(performance.now() - started);
  } finally { activeDownloads--; }
}

try {
  // No show change: upload an original fixture tone only when no saved stems exist.
  let tracks = before.show.tracks;
  if (!tracks.length) {
    const data = await Bun.file(new URL("../../fixtures/media/tone-0.wav", import.meta.url)).arrayBuffer();
    const query = new URLSearchParams({ commandId: runKey, label: "Synthetic load-test original tone",
      byteSize: String(data.byteLength), durationMs: "8000", sampleRateHz: "48000", channels: "1" });
    tracks = [await (await request(`/api/assets?${query}`, { method: "POST", body: data }, true)).json()];
  }
  console.log(`Joining ${count} public clients; injected one-way base 80/160/240/320 ms + jitter and queue spikes.`);
  const started = performance.now();
  clients.push(...Array.from({ length: count }, (_, index) => new Phone(index)));
  await Promise.all(clients.map(client => client.connect()));
  downloads = clients.map(async () => { for (const track of tracks) await download(track.url, track.sha256, track.byteSize); });
  await waitFor(async () => clients.every(client => client.clock.quality().ready));
  console.log(`All clocks ready after ${((performance.now() - started) / 1000).toFixed(1)}s; ${activeDownloads} downloads still active.`);
  const created = await operator("/api/calibrations", { participantIds: clients.map(client => client.id),
    ...DEFAULT_CALIBRATION_PALETTE });
  ownedRunId = created.plan.runId;
  const readyCount = async () => {
    const current = await snapshot();
    return current.preparations.find((item: { preparationId: string }) => item.preparationId === created.preparationId)?.readyIds.length ?? 0;
  };
  await waitFor(async () => await readyCount() === count);
  const recovering = clients.slice(0, Math.min(25, count));
  for (const client of recovering) { client.forceUnready = true; client.status(); }
  await waitFor(async () => await readyCount() <= count - recovering.length);
  for (const client of recovering) { client.forceUnready = false; client.status(); }
  await waitFor(async () => await readyCount() === count);
  const reconnecting = clients.slice(25, Math.min(30, count));
  for (const client of reconnecting) client.disconnect();
  await Promise.all(reconnecting.map(client => client.connect()));
  await waitFor(async () => await readyCount() === count && clients.every(client => client.clock.quality().ready));
  // Re-download while arming so media and timing traffic overlap at the critical moment.
  await Promise.all(downloads);
  sustainedDownloads = true;
  downloads = clients.map(async () => {
    do {
      for (const track of tracks) await download(track.url, track.sha256, track.byteSize);
      await Bun.sleep(100);
    } while (sustainedDownloads);
  });
  const armStarted = performance.now();
  const armed = await operator(`/api/calibrations/${ownedRunId}/arm`, {
    runId: ownedRunId, preparationId: created.preparationId,
  }, 3000); // Operator has no clock; simulate a three-second delayed command.
  const operatorDelayAndResponseMs = performance.now() - armStarted;
  const downloadsActiveAtArmResponse = activeDownloads;
  deadlineAt = armed.effectiveServerMs;
  assert.equal(armed.ready, count);
  await waitFor(async () => clients.every(client => client.acceptedArms === 1), 15000);
  sustainedDownloads = false;
  await Promise.all(downloads);
  const after = await snapshot();
  assert.equal(JSON.stringify(after.show), showBefore, "Load test changed saved show");
  assert(margins.every(value => value > 0), "A client received its arm late");
  assert.equal(errors.length, 0, `Server/client errors: ${errors.slice(0, 5)}`);
  const report = { date: new Date().toISOString(), target: base, clients: count, serverEpoch: info.serverEpoch,
    injection: "Ordered application delays: 80/160/240/320 ms each way; 0..30 ms shared pair jitter, 0..8 ms per-probe jitter; 4% +300 ms uplink pair spikes; 2% +1000 ms downlink spikes",
    seed: 20261028, recoveryCount: recovering.length, reconnectCount: reconnecting.length,
    readyAtArm: armed.ready, armsReceived: clients.filter(c => c.receivedArms === 1).length,
    armsAccepted: clients.filter(c => c.acceptedArms === 1).length, cueMarginMs: summarize(margins), minimumCueMarginMs: Math.min(...margins),
    totalSeconds: (performance.now() - started) / 1000, operatorDelayAndResponseMs, downloadsActiveAtArmResponse,
    serverChosenStart: deadlineAt, bytesDownloaded, downloads: downloadMs.length, maxConcurrentDownloads,
    downloadMs: summarize(downloadMs), uncertaintyMs: summarize(clients.map(c => c.clock.quality().uncertaintyMs ?? Infinity)),
    probes: clients.reduce((sum, c) => sum + c.probes, 0),
    httpResponseHeadersMs: Object.fromEntries(Object.entries(httpMs).map(([path, times]) => [path, summarize(times)])),
    errors, savedShowUnchanged: true,
    limitations: "One load generator/public WAN path; injected timers, not independent Wi-Fi radios; original tone when show is empty; verifies media bytes and scheduling, not decode/audio/optical performance. Test device IDs remain allocated." };
  await mkdir("runtime", { recursive: true });
  await writeFile(process.env.LOAD_REPORT ?? "runtime/calibration-stage-load.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  sustainedDownloads = false;
  for (const client of clients) client.disconnect();
  await Promise.allSettled(downloads);
  if (ownedRunId) {
    const current = await snapshot();
    if (current.calibration?.plan.runId === ownedRunId) await request(`/api/calibrations/${ownedRunId}`, { method: "DELETE" }, true);
  }
}
