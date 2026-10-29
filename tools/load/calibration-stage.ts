import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { ClientMessage, ServerMessage, DEFAULT_CALIBRATION_PALETTE, type ServerMessageData } from "@orchestra/contracts";
import { ClockSync } from "../../packages/sync/src";
import { CalibrationSession } from "../../client-frontend/src/lib/calibration";
import { FlashRenderer } from "../../client-frontend/src/lib/flash-renderer";
import { ShowControl } from "../../client-frontend/src/lib/show-control";
import { DecodedBudget, preloadTracks, type LoadedTrack, type TrackData } from "../../packages/audio/src/assets";
import { summarize } from "./metrics";

// Public-origin control/media test, using actual clock + calibration client implementations.
// Timers inject ordered application-layer delay; this is not network packet shaping or
// independent radio clients. It does not play audio, render screens, or reset/save the show.
const base = (process.env.LOAD_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const control = process.env.LOAD_CONTROL_URL ?? base;
const count = Number(process.env.LOAD_CLIENTS ?? 250);
const ineligibleCount = count >= 50 ? 5 : 1;
const eligibleCount = count - ineligibleCount;
const performanceChecks = process.env.LOAD_PERFORMANCE === "1";
const secret = process.env.OPERATOR_SECRET;
assert(secret, "Set OPERATOR_SECRET in the environment");
assert(Number.isInteger(count) && count >= 2 && count <= 250, "2..250 clients required");
const runKey = `stage-load-${Date.now()}`;
const httpMs: Record<string, number[]> = {};
let httpReadRetries = 0;
async function request(path: string, init?: RequestInit, operator = false) {
  const start = performance.now();
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch((operator ? control : base) + path, { ...init, signal: AbortSignal.timeout(120000),
        headers: { ...(operator ? { "x-operator-secret": secret! } : {}), ...init?.headers } });
      break;
    } catch (cause) {
      if ((init?.method ?? "GET") !== "GET" || attempt === 2) throw cause;
      httpReadRetries++; await Bun.sleep(250 * (attempt + 1));
    }
  }
  assert(response, "No HTTP response");
  (httpMs[path.split("?")[0]] ??= []).push(performance.now() - start);
  assert(response.ok, `HTTP ${response.status} on ${path.split("?")[0]}`);
  return response;
}
const info = await (await request("/api/session")).json();
const snapshot = async () => (await request(`/api/sessions/${info.sessionId}/snapshot`, undefined, true)).json();
const before = await snapshot();
const diagnosticsBefore = await (await request("/api/foundation", undefined, true)).json();
assert(!before.calibration, "An existing calibration is active; leave it untouched");
assert.equal(before.transport.status, "stopped", "Do not load-test an active performance");
assert.equal(before.pendingActions.length, 0, "Do not replace pending commands");
if (performanceChecks) assert(before.devices.every((device: { connected: boolean }) => !device.connected), "Performance checks require no existing connected audience");
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
let bytesDownloaded = 0, maxConcurrentDownloads = 0, activeDownloads = 0;
const downloadMs: number[] = [], margins: number[] = [], errors: string[] = [];
let deadlineAt = 0;
let performanceTouched = false;
let performanceReport: Record<string, unknown> | null = null;
let mediaAttempts = 0, injectedMediaFailures = 0;

class Phone {
  socket: WebSocket | null = null;
  token = "";
  id = -1;
  foreground = true;
  forceUnready = false;
  receivedArms = 0;
  acceptedArms = 0;
  patternsCompleted = 0;
  patternsInterrupted = 0;
  snapshot: Extract<ServerMessageData, { type: "state.snapshot" }>["payload"] | null = null;
  readonly cache = new Map<string, LoadedTrack>();
  readonly budget = new DecodedBudget();
  transportMargins: number[] = [];
  assignmentPreparationsReceived = 0;
  readonly playback = new ShowControl({
    identity: () => ({ sessionId: info.sessionId, serverEpoch: info.serverEpoch, deviceId: this.id }),
    send: message => this.delayedSend(message), now: () => this.clock.quality().ready ? this.clock.nowServerMs() : null,
    preload: async () => {}, // Transfers below use the real preload implementation; no browser decoder.
    facts: () => ({ audioRunning: true, audioOutputReady: true,
      clockUsable: this.foreground && !this.forceUnready && this.clock.quality().ready,
      verified: (id, hash) => this.cache.get(id)?.sha256 === hash }),
  });
  private renderer: FlashRenderer | null = null;
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
  get expectedReady() { return this.index < eligibleCount; }
  private get oneWayMs() { return this.expectedReady ? 80 + (this.index % 4) * 55 : 450; }
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
        const at = Math.max(this.lastDown, performance.now() + this.oneWayMs + random() * 30
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
    const at = Math.max(this.lastUp, performance.now() + this.oneWayMs + jitter);
    this.lastUp = at;
    const socket = this.socket;
    this.later(() => { if (this.socket === socket && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }, at);
  }
  status() {
    const quality = this.clock.quality();
    this.send("device.status", { deviceId: this.id, connected: true, foreground: this.foreground,
      clockReady: !this.forceUnready && quality.ready, clockUncertaintyMs: quality.uncertaintyMs,
      clockSampleAgeMs: quality.sampleAgeMs, audioUnlocked: true,
      decodedTrackHashes: Object.fromEntries([...this.cache.values()].map(track => [track.trackId, track.sha256])) });
  }
  private receive(raw: string) {
    let message: ServerMessageData;
    try { message = ServerMessage.parse(JSON.parse(raw)); } catch { errors.push("Invalid server message"); return; }
    if (message.type === "clock.reply") this.clock.accept({ ...message.payload, serverEpoch: message.serverEpoch });
    if (performanceChecks) {
      if (message.type === "assignment.prepare") this.assignmentPreparationsReceived++;
      if (message.type === "state.snapshot" && message.payload.role === "participant") { this.snapshot = message.payload; this.playback.applySnapshot(message.payload); }
      else this.playback.handle(message);
      if (message.type === "transport.commit" && message.payload.transport.status === "playing") this.transportMargins.push(message.effectiveServerMs - this.clock.nowServerMs());
    }
    if (message.type === "calibration.prepare") this.calibration.onPrepare(message, {
      foreground: this.foreground, clockUsable: !this.forceUnready && this.clock.quality().ready, optedOut: false,
    });
    if (message.type === "calibration.arm") {
      this.receivedArms++;
      margins.push(message.effectiveServerMs - this.clock.nowServerMs());
      if (this.clock.quality().ready) this.calibration.onArm(message, this.clock.nowServerMs());
      const phase = this.calibration.phase;
      if (phase.kind === "armed") {
        this.acceptedArms++;
        this.renderer = new FlashRenderer({ clock: this.clock, clockUsable: () => this.clock.quality().ready,
          run: phase.run, packet: phase.packet,
          frames: { request: callback => setTimeout(callback, 16), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
          paint: () => {}, // Execute the real timing/eligibility path without a physical screen.
          onDone: lateness => { this.patternsCompleted++; this.calibration.complete(lateness); },
          onClockLost: () => {
            console.log(JSON.stringify({ clockLost: this.index, quality: this.clock.quality(), stats: this.clock.estimator.stats() }));
            this.patternsInterrupted++; this.calibration.abort("clock");
          } });
        this.renderer.start();
      }
    }
    if (message.type === "error") errors.push(message.payload.error.code);
  }
  disconnect() {
    this.renderer?.stop();
    this.clock.stop();
    this.playback.disconnected();
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
    this.socket?.close(); this.socket = null;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear(); this.lastUp = 0; this.lastDown = 0;
    this.calibration.abort("disconnected");
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 90000, label = "condition") {
  console.log(`Waiting for ${label}`);
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) { if (await check()) return; await Bun.sleep(500); }
  const current = await snapshot();
  console.log(JSON.stringify({ waitingFor: label, clockReady: clients.filter(c => c.clock.quality().ready).length,
    preparations: current.preparations.map((p: { readyIds: number[]; excluded: unknown[] }) => ({ ready: p.readyIds.length, excluded: p.excluded.length })),
    slowClients: clients.filter(c => !c.clock.quality().ready).slice(0, 10).map(c => ({ index: c.index, quality: c.clock.quality(), stats: c.clock.estimator.stats() })) }));
  throw new Error(`Timed out waiting for ${label}`);
}
async function download(url: string, hash: string, expectedSize: number): Promise<void> {
  const started = performance.now(); activeDownloads++; maxConcurrentDownloads = Math.max(maxConcurrentDownloads, activeDownloads);
  try {
    const response = await request(url, { cache: "no-store" });
    const reader = response.body!.getReader(), hasher = new Bun.CryptoHasher("sha256");
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength; hasher.update(chunk.value);
      // Finite stem transfers at 256 kbit/s per phone; keep realistic downloads
      // overlapping the pattern without repeatedly refetching a tiny cached tone.
      await Bun.sleep(chunk.value.byteLength / 32768 * 1000);
    }
    assert.equal(size, expectedSize);
    assert.equal(hasher.digest("hex"), hash);
    bytesDownloaded += size; downloadMs.push(performance.now() - started);
  } finally { activeDownloads--; }
}

async function preload(client: Phone, tracks: TrackData[]) {
  let attempt = 0;
  const fetchTrack = async (url: string, init?: RequestInit): Promise<Response> => {
    mediaAttempts++; attempt++;
    if (attempt === 1 && client.index < 25) { injectedMediaFailures++; return new Response(null, { status: 503 }); }
    if (attempt === 1 && client.index >= 25 && client.index < 30) {
      injectedMediaFailures++;
      return new Response(new ReadableStream()); // Real 30-second idle timeout, then bounded retry.
    }
    const started = performance.now(); activeDownloads++; maxConcurrentDownloads = Math.max(maxConcurrentDownloads, activeDownloads);
    try {
      const response = await fetch(url, { ...init, cache: "no-store" });
      if (!response.ok || !response.body) { activeDownloads--; return response; }
      const reader = response.body.getReader();
      let closed = false;
      const finish = () => { if (!closed) { closed = true; activeDownloads--; downloadMs.push(performance.now() - started); } };
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { finish(); controller.close(); return; }
            await Bun.sleep(chunk.value.byteLength / 32768 * 1000);
            bytesDownloaded += chunk.value.byteLength; controller.enqueue(chunk.value);
          } catch (error) { finish(); controller.error(error); }
        },
        async cancel() { finish(); await reader.cancel(); },
      });
      return new Response(stream, { status: response.status, headers: response.headers });
    } catch (error) { activeDownloads--; throw error; }
  };
  const options = { budget: client.budget, baseUrl: base, fetch: fetchTrack,
    ctx: { decodeAudioData: async () => ({ length: 1, numberOfChannels: 1 } as AudioBuffer) } };
  assert.deepEqual(await preloadTracks(tracks, options, client.cache), []);
  const attempts = attempt;
  assert.deepEqual(await preloadTracks(tracks, options, client.cache), []);
  assert.equal(attempt, attempts, "Cached preload generated more requests");
  client.status();
}

async function checkPerformance() {
  const eligible = clients.filter(client => client.expectedReady);
  const current = await snapshot();
  const context = { showRevision: current.show.showRevision, positionMs: 0 };
  const prepared = await operator("/api/transport", { ...context, action: "prepare", expectedRevision: current.transport.transportRevision });
  assert(prepared.commandId);
  const ready = async (domain: string) => (await snapshot()).preparations.find((p: { domain: string }) => p.domain === domain)?.readyIds.length ?? 0;
  await waitFor(async () => await ready("transport") === eligibleCount, 90000, "playback acknowledgements");
  const recovering = eligible.slice(0, Math.min(25, eligibleCount));
  for (const phone of recovering) { phone.forceUnready = true; phone.status(); }
  await waitFor(async () => await ready("transport") <= eligibleCount - recovering.length, 30000, "playback ACK withdrawal");
  for (const phone of recovering) { phone.forceUnready = false; phone.status(); }
  await waitFor(async () => await ready("transport") === eligibleCount, 90000, "automatic playback ACK recovery");
  performanceTouched = true;
  const playing = await operator("/api/transport", { ...context, action: "play", expectedRevision: current.transport.transportRevision }, 3000);
  const excluded = new Set<number>(playing.excluded.map((p: { deviceId: number }) => p.deviceId));
  const recipients = eligible.filter(phone => !excluded.has(phone.id));
  assert(playing.ready >= Math.ceil(eligibleCount * 0.99));
  await waitFor(async () => recipients.every(phone => phone.transportMargins.length === 1), 15000, "server-timed Play delivery");
  assert(recipients.every(phone => phone.transportMargins[0] > 0));
  await waitFor(async () => (await snapshot()).transport.status === "playing", 15000, "effective playback");
  const playingSnapshot = await snapshot();
  const assignment = { mapRevision: playingSnapshot.audienceMap.mapRevision, expectedRevision: playingSnapshot.assignmentRevision,
    channelId: playingSnapshot.show.channels[0].channelId, deviceIds: recovering.map(phone => phone.id) };
  for (const phone of recovering) { phone.forceUnready = true; phone.status(); }
  const selection = await operator("/api/assignments/prepare", assignment);
  await waitFor(async () => { const barrier = (await snapshot()).preparations.find((p: { domain: string }) => p.domain === "assignment");
    return barrier?.readyIds.length === 0 && barrier.excluded.length === recovering.length
      && recovering.every(phone => phone.assignmentPreparationsReceived >= 1); }, 15000, "assignment initial exclusions");
  for (const phone of recovering) { phone.forceUnready = false; phone.status(); }
  await waitFor(async () => await ready("assignment") === recovering.length, 90000, "automatic assignment ACK recovery");
  assert(recovering.every(phone => phone.assignmentPreparationsReceived >= 2), "Assignment preparation was not replayed");
  const assigned = await operator("/api/assignments", { ...assignment, preparationId: selection.preparationId });
  assert.equal(assigned.ready, recovering.length);
  const mixed = await operator("/api/mix", { expectedRevision: playingSnapshot.mix.mixRevision, masterGain: 0.5, channels: playingSnapshot.show.channels });
  await waitFor(async () => (await snapshot()).mix.masterGain === 0.5, 15000, "server-timed mix");
  performanceReport = { readyAtPlay: playing.ready, playStart: playing.effectiveServerMs,
    minimumDeliveryMarginMs: Math.min(...recipients.map(phone => phone.transportMargins[0])),
    ackRecoveries: recovering.length, assignmentAckRecoveries: recovering.length,
    assignmentStart: assigned.effectiveServerMs, mixStart: mixed.effectiveServerMs,
    injectedOperatorDelayMs: 3000, timestampsSent: false };
}

async function restorePerformance() {
  if (!performanceTouched) return;
  const current = await snapshot();
  assert.equal(current.serverEpoch, info.serverEpoch, "Server restarted during testing; do not mutate a new epoch");
  const transportRevision = Math.max(current.transport.transportRevision,
    ...current.pendingActions.filter((action: { domain: string }) => action.domain === "transport").map((action: { transport: { transportRevision: number } }) => action.transport.transportRevision));
  const mixRevision = Math.max(current.mix.mixRevision,
    ...current.pendingActions.filter((action: { domain: string }) => action.domain === "mix").map((action: { mixRevision: number }) => action.mixRevision));
  await operator("/api/transport", { action: "stop", showRevision: current.show.showRevision, positionMs: 0, expectedRevision: transportRevision });
  await operator("/api/mix", { expectedRevision: mixRevision, masterGain: before.mix.masterGain, channels: before.show.channels });
  await operator("/api/assignments", { expectedRevision: current.assignmentRevision, mapRevision: current.audienceMap.mapRevision,
    deviceIds: clients.map(phone => phone.id), channelId: null });
  await waitFor(async () => { const restored = await snapshot(); return restored.transport.status === "stopped"
    && restored.pendingActions.length === 0 && restored.mix.masterGain === before.mix.masterGain; }, 20000, "restored stopped performance state");
  performanceTouched = false;
}

try {
  // No show change: upload an original fixture tone only when no saved stems exist.
  let tracks = before.show.tracks;
  if (!tracks.length) {
    const original = new Uint8Array(await Bun.file(new URL("../../fixtures/media/tone-0.wav", import.meta.url)).arrayBuffer());
    const data = new Uint8Array(44 + (original.length - 44) * 4);
    data.set(original.subarray(0, 44));
    for (let i = 0; i < 4; i++) data.set(original.subarray(44), 44 + i * (original.length - 44));
    const header = new DataView(data.buffer);
    header.setUint32(4, data.length - 8, true); header.setUint32(40, data.length - 44, true);
    const query = new URLSearchParams({ commandId: runKey, label: "Synthetic load-test original tone",
      byteSize: String(data.byteLength), durationMs: "32000", sampleRateHz: String(header.getUint32(24, true)), channels: "1" });
    tracks = [await (await request(`/api/assets?${query}`, { method: "POST", body: data.buffer }, true)).json()];
  }
  assert(tracks.reduce((sum: number, track: TrackData) => sum + track.byteSize, 0) * count * 2 <= 600_000_000, "Media exceeds the bounded 600 MB test budget");
  console.log(`Joining ${count} public clients; ${eligibleCount} with one-way base 80/135/190/245 ms, ${ineligibleCount} deliberately at 450 ms each way; plus jitter/spikes.`);
  const started = performance.now();
  clients.push(...Array.from({ length: count }, (_, index) => new Phone(index)));
  await Promise.all(clients.map(client => client.connect()));
  downloads = clients.map(async client => { if (performanceChecks) await preload(client, tracks);
    else for (const track of tracks) await download(track.url, track.sha256, track.byteSize); });
  const eligible = clients.filter(client => client.expectedReady);
  const ineligible = clients.filter(client => !client.expectedReady);
  await waitFor(async () => eligible.every(client => client.clock.quality().ready)
    && ineligible.every(client => client.clock.estimator.stats().measurements === 16 && !client.clock.quality().ready), 90000, "clock eligibility and deliberate exclusions");
  console.log(`All clocks ready after ${((performance.now() - started) / 1000).toFixed(1)}s; ${activeDownloads} downloads still active.`);
  const created = await operator("/api/calibrations", { participantIds: clients.map(client => client.id),
    ...DEFAULT_CALIBRATION_PALETTE });
  ownedRunId = created.plan.runId;
  const readyCount = async () => {
    const current = await snapshot();
    return current.preparations.find((item: { preparationId: string }) => item.preparationId === created.preparationId)?.readyIds.length ?? 0;
  };
  await waitFor(async () => await readyCount() === eligibleCount, 90000, "initial calibration acknowledgements");
  const recovering = eligible.slice(0, Math.min(25, eligibleCount));
  for (const client of recovering) { client.forceUnready = true; client.status(); }
  await waitFor(async () => await readyCount() <= eligibleCount - recovering.length, 90000, "readiness withdrawal");
  for (const client of recovering) { client.forceUnready = false; client.status(); }
  await waitFor(async () => await readyCount() === eligibleCount, 90000, "readiness recovery");
  const reconnecting = eligible.slice(25, Math.min(30, eligibleCount));
  for (const client of reconnecting) client.disconnect();
  await Promise.all(reconnecting.map(client => client.connect()));
  await waitFor(async () => await readyCount() === eligibleCount && eligible.every(client => client.clock.quality().ready), 90000, "reconnect recovery");
  // Re-download while arming so media and timing traffic overlap at the critical moment.
  await Promise.all(downloads);
  downloads = clients.map(async () => { for (const track of tracks) await download(track.url, track.sha256, track.byteSize); });
  const armStarted = performance.now();
  const armed = await operator(`/api/calibrations/${ownedRunId}/arm`, {
    runId: ownedRunId, preparationId: created.preparationId,
  }, 3000); // Operator has no clock; simulate a three-second delayed command.
  const operatorDelayAndResponseMs = performance.now() - armStarted;
  const downloadsActiveAtArmResponse = activeDownloads;
  deadlineAt = armed.effectiveServerMs;
  // Readiness may change during the deliberately delayed HTTP command. Verify the
  // authoritative ready subset, rather than requiring a phone that just withdrew.
  const excludedIds = new Set<number>(armed.excluded.map((item: { deviceId: number }) => item.deviceId));
  const recipients = eligible.filter(client => !excludedIds.has(client.id));
  assert.equal(armed.ready, recipients.length);
  assert(armed.ready >= Math.ceil(eligibleCount * 0.99), "Fewer than 99% of modeled eligible clients ready at arm");
  await waitFor(async () => recipients.every(client => client.acceptedArms === 1), 15000, "future arm delivery");
  await waitFor(async () => {
    assert(clients.every(client => client.patternsInterrupted === 0), "Clock lost during simulated pattern");
    return recipients.every(client => client.patternsCompleted === 1);
  }, 30000, "full pattern completion");
  if (performanceChecks) { await checkPerformance(); await restorePerformance(); }
  await Promise.all(downloads);
  const after = await snapshot();
  const diagnosticsAfter = await (await request("/api/foundation", undefined, true)).json();
  assert.equal(JSON.stringify(after.show), showBefore, "Load test changed saved show");
  assert(margins.every(value => value > 0), "A client received its arm late");
  assert(ineligible.every(client => !client.clock.quality().ready && client.receivedArms === 0), "Ineligible phones must remain excluded");
  assert(clients.filter(client => excludedIds.has(client.id)).every(client => client.receivedArms === 0), "A withdrawn phone received an arm");
  assert.equal(errors.length, 0, `Server/client errors: ${errors.slice(0, 5)}`);
  const report = { date: new Date().toISOString(), target: base, clients: count, serverEpoch: info.serverEpoch,
    injection: "245 eligible clients (at 250 total): 80/135/190/245 ms each way; 5 deliberate exclusions: 450 ms each way; 0..30 ms shared pair jitter, 0..8 ms per-probe jitter; 4% +300 ms uplink pair spikes; 2% +1000 ms downlink spikes",
    eligibleCount, deliberatelyExcluded: ineligibleCount,
    transientExclusionsAtArm: eligibleCount - armed.ready,
    seed: 20261028, recoveryCount: recovering.length, reconnectCount: reconnecting.length,
    readyAtArm: armed.ready, armsReceived: clients.filter(c => c.receivedArms === 1).length,
    armsAccepted: clients.filter(c => c.acceptedArms === 1).length, cueMarginMs: summarize(margins), minimumCueMarginMs: Math.min(...margins),
    patternsCompleted: clients.filter(c => c.patternsCompleted === 1).length, patternsInterrupted: clients.reduce((sum, c) => sum + c.patternsInterrupted, 0),
    totalSeconds: (performance.now() - started) / 1000, operatorDelayAndResponseMs, downloadsActiveAtArmResponse,
    serverChosenStart: deadlineAt, bytesDownloaded, downloads: downloadMs.length, maxConcurrentDownloads,
    downloadMs: summarize(downloadMs), uncertaintyMs: summarize(clients.map(c => c.clock.quality().uncertaintyMs ?? Infinity)),
    eligibleUncertaintyMs: summarize(eligible.map(c => c.clock.quality().uncertaintyMs ?? Infinity)),
    ineligibleUncertaintyMs: summarize(ineligible.map(c => c.clock.quality().uncertaintyMs ?? Infinity)),
    probes: clients.reduce((sum, c) => sum + c.probes, 0),
    httpResponseHeadersMs: Object.fromEntries(Object.entries(httpMs).map(([path, times]) => [path, summarize(times)])),
    errors, httpReadRetries, savedShowUnchanged: true,
    performance: performanceReport, mediaAttempts, injectedMediaFailures,
    diagnosticsBefore: diagnosticsBefore.diagnostics, diagnosticsAfter: diagnosticsAfter.diagnostics,
    limitations: "One load generator/public WAN path; injected timers, not independent Wi-Fi radios; original tone when show is empty; verifies media bytes and scheduling, not decode/audio/optical performance. Test device IDs remain allocated." };
  await mkdir("runtime", { recursive: true });
  await writeFile(process.env.LOAD_REPORT ?? "runtime/calibration-stage-load.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { await restorePerformance(); } catch (error) { console.error("Performance cleanup failed:", String(error)); }
  for (const client of clients) client.disconnect();
  await Promise.allSettled(downloads);
  if (ownedRunId) {
    const current = await snapshot();
    if (current.calibration?.plan.runId === ownedRunId) await request(`/api/calibrations/${ownedRunId}`, { method: "DELETE" }, true);
  }
}
