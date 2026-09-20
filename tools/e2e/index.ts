import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import { AdminSnapshot, ServerMessage, Track, type ParticipantSnapshotData, type ShowData } from "@orchestra/contracts";
import { ClockSync } from "../../packages/sync/src/index";
import { selectRectangle } from "../../packages/selection/src/index";
import { ShowControl, type Engine } from "../../client-frontend/src/lib/show-control";
import { pythonExecutable, ROOT } from "../../scripts/run";

// Real HTTP/WebSocket control, real encoded media, real Python decoder. Audio output is a
// recording double here; browser and physical acoustic evidence are separate checks.
const directory = resolve(ROOT, "runtime/e2e", crypto.randomUUID());
await mkdir(directory, { recursive: true });
const port = Number(process.env.E2E_PORT ?? 18089), base = `http://127.0.0.1:${port}`;
const secret = crypto.randomUUID(), sessionId = "integration-test";
const headers = { "x-operator-secret": secret, "content-type": "application/json" };
const checks: string[] = [];
const check = (description: string) => { checks.push(description); console.log(`PASS ${description}`); };
let epoch = "";
let server: ReturnType<typeof Bun.spawn> | undefined;
async function until<T>(read: () => Promise<T> | T, accept: (value: T) => boolean, ms = 15000): Promise<T> {
  const end = performance.now() + ms;
  for (;;) { const value = await read(); if (accept(value)) return value; if (performance.now() >= end) throw new Error(`Timed out waiting: ${JSON.stringify(value)}`); await Bun.sleep(100); }
}
async function startServer() {
  server = Bun.spawn([process.execPath, "backend/src/index.ts"], { cwd: ROOT, env: { ...process.env,
    PORT: String(port), HOST: "127.0.0.1", SESSION_ID: sessionId, OPERATOR_SECRET: secret,
    CHECKPOINT_PATH: `${directory}/checkpoint.json`, ASSETS_PATH: `${directory}/assets`, UPLOADS_PATH: `${directory}/uploads`, JOBS_PATH: `${directory}/jobs`,
    OTC_COMMAND: "", OTC_COMMAND_JSON: "",
  }, stdout: Bun.file(`${directory}/server.log`), stderr: Bun.file(`${directory}/server-errors.log`) });
  await until(() => fetch(`${base}/api/health`).then(response => response.ok).catch(() => false), Boolean);
  epoch = (await (await fetch(`${base}/api/session`)).json()).serverEpoch;
}
const snapshot = async () => AdminSnapshot.parse(await (await fetch(`${base}/api/sessions/${sessionId}/snapshot`, { headers })).json());
async function request(path: string, body: object, method = "POST", status = 200) {
  const response = await fetch(`${base}${path}`, { method, headers, body: JSON.stringify({ protocolVersion: 1, sessionId, serverEpoch: epoch, commandId: crypto.randomUUID(), expectedRevision: 0, ...body }) });
  const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
}
class Phone {
  ws!: WebSocket;
  snapshot: ParticipantSnapshotData | null = null;
  token = ""; id = -1; audioReady = true;
  calls: string[] = []; hashes: Record<string, string> = {};
  readonly clock = new ClockSync({ send: payload => this.send("clock.probe", payload) });
  readonly control = new ShowControl({
    send: message => this.ws.send(JSON.stringify(message)), identity: () => this.snapshot ? { sessionId, serverEpoch: this.snapshot.serverEpoch, deviceId: this.id } : null,
    now: () => this.clock.nowServerMs(), preload: show => this.preload(show),
    facts: () => ({ audioRunning: this.audioReady, audioOutputReady: this.audioReady, clockUsable: this.clock.quality().ready, verified: (id, hash) => this.hashes[id] === hash }),
  });
  readonly engine: Engine = {
    load: () => this.calls.push("load"), setTransport: transport => this.calls.push(`transport:${transport.status}:${transport.transportRevision}`),
    setChannel: channel => this.calls.push(`channel:${channel}`), setMix: mix => this.calls.push(`mix:${mix.masterGain}`),
    panic: () => this.calls.push("panic"), renewLease: () => {}, contextResumed: () => {},
  };
  send(type: string, payload: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ protocolVersion: 1, sessionId, serverEpoch: epoch, messageId: crypto.randomUUID(), type, payload })); }
  async preload(show: ShowData) {
    for (const track of show.tracks) {
      const bytes = await (await fetch(new URL(track.url, base))).arrayBuffer();
      assert.equal(bytes.byteLength, track.byteSize); assert.equal(createHash("sha256").update(new Uint8Array(bytes)).digest("hex"), track.sha256);
      this.hashes[track.trackId] = track.sha256;
    }
  }
  async connect() {
    const joined = await (await fetch(`${base}/api/sessions/${sessionId}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(this.token ? { resumeToken: this.token } : {}) })).json();
    this.token = joined.resumeToken; this.id = joined.deviceId;
    this.snapshot = null;
    this.ws = new WebSocket(`${base.replace("http", "ws")}/ws?resumeToken=${encodeURIComponent(this.token)}`);
    this.ws.onmessage = event => {
      const message = ServerMessage.parse(JSON.parse(String(event.data)));
      if (message.type === "state.snapshot" && message.payload.role === "participant") {
        this.snapshot = message.payload; this.clock.start(message.serverEpoch); this.control.applySnapshot(message.payload);
      } else if (message.type === "clock.reply") this.clock.accept({ ...message.payload, serverEpoch: message.serverEpoch });
      else if (message.type === "calibration.prepare") this.send("calibration.ready", { preparationId: message.payload.preparationId, runId: message.payload.plan.runId, ready: this.clock.quality().ready, reason: null });
      else this.control.handle(message);
    };
    await until(() => this.snapshot, Boolean);
    await this.preload(this.snapshot!.show);
    await until(() => this.clock.quality().ready, Boolean);
    this.control.attach(this.engine);
    this.status();
  }
  status() { const quality = this.clock.quality(); this.send("device.status", { deviceId: this.id, connected: true, foreground: true,
    clockReady: quality.ready, clockUncertaintyMs: quality.uncertaintyMs, clockSampleAgeMs: quality.sampleAgeMs, audioUnlocked: this.audioReady, decodedTrackHashes: this.hashes }); }
  close() { this.control.disconnected(); this.control.attach(null); this.clock.stop(); this.ws?.close(); }
}
const phones = Array.from({ length: 4 }, () => new Phone());
const started = performance.now();
try {
  await startServer();
  assert.equal((await fetch(`${base}/api/sessions/${sessionId}/snapshot`)).status, 401);
  const fixture: ShowData = await Bun.file("fixtures/show.json").json();
  const tracks: ShowData["tracks"] = [];
  for (const track of fixture.tracks) {
    const bytes = await Bun.file(`fixtures/media/${track.trackId}.wav`).arrayBuffer();
    const query = new URLSearchParams({ commandId: crypto.randomUUID(), label: track.label, byteSize: String(bytes.byteLength), durationMs: String(track.durationMs), sampleRateHz: String(track.sampleRateHz), channels: String(track.channels) });
    const response = await fetch(`${base}/api/assets?${query}`, { method: "POST", headers, body: bytes });
    assert.equal(response.status, 200); tracks.push(Track.parse(await response.json()));
  }
  const show = { ...fixture, tracks, clips: fixture.clips.map(clip => ({ ...clip, trackId: tracks[fixture.tracks.findIndex(track => track.trackId === clip.trackId)].trackId })) };
  await request("/api/show", { show }, "PUT");
  await Promise.all(phones.map(phone => phone.connect()));
  assert.deepEqual(phones.map(phone => phone.id), [0, 1, 2, 3]);
  check("operator authentication, four real joins, shared clock convergence, hash-verified media download");
  phones[0].send("participant.column", { column: "left" });
  let current = await until(snapshot, s => s.audienceMap.mapRevision === 1);
  assert.equal(current.audienceMap.locations[0].x, null); assert.equal(current.audienceMap.locations[0].mappingMode, "manual-column");
  check("manual column remains explicitly coarse with no fabricated coordinates");
  const created = await request("/api/calibrations", { participantIds: phones.map(phone => phone.id), palette: { zero: "#FFB000", one: "#0066FF", neutral: "#111111" }, paletteVersion: "amber-blue-v1" });
  await until(snapshot, s => s.preparations.find(p => p.domain === "calibration")?.readyIds.length === 4);
  current = await snapshot();
  const startServerMs = current.serverMs + 4000;
  await request(`/api/calibrations/${created.plan.runId}/arm`, { runId: created.plan.runId, preparationId: created.preparationId, effectiveServerMs: startServerMs });
  const template = await Bun.file("fixtures/otc/clean-30/manifest.json").json();
  const manifestPath = `${directory}/generator-input.json`;
  await writeFile(manifestPath, JSON.stringify({ ...template, ...created.plan, startServerMs }));
  const generator = Bun.spawn([pythonExecutable(), "tools/otc-fixtures/generate.py", "--output-dir", `${directory}/capture`, "--manifest-path", manifestPath], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  assert.equal(await generator.exited, 0);
  const generated = await Bun.file(`${directory}/capture/manifest.json`).json();
  const uploads = [];
  for (const camera of generated.cameras) {
    const bytes = await Bun.file(camera.videoPath).arrayBuffer();
    const query = new URLSearchParams({ commandId: crypto.randomUUID(), cameraId: camera.cameraId, primaryColumn: camera.primaryColumn, rotationDegrees: String(camera.rotationDegrees),
      byteSize: String(bytes.byteLength), label: `${camera.cameraId}.mp4`, anchors: JSON.stringify(camera.anchors), exclusionRois: "[]" });
    const response = await fetch(`${base}/api/calibrations/${created.plan.runId}/uploads?${query}`, { method: "POST", headers, body: bytes });
    assert.equal(response.status, 200, await response.clone().text()); uploads.push(await response.json());
  }
  const runId = created.plan.runId;
  const job = await request(`/api/calibrations/${runId}/jobs`, { runId, uploadIds: uploads.map(upload => upload.uploadId), evidence: "synthetic" });
  const completed = await until(async () => (await fetch(`${base}/api/jobs/${job.jobId}`, { headers })).json(), j => ["complete", "failed", "cancelled"].includes(j.progress.stage), 120000);
  assert.equal(completed.progress.stage, "complete", JSON.stringify(completed));
  assert.equal(completed.result.evidence, "synthetic");
  assert.equal(completed.result.locations.filter((location: { status: string }) => location.status === "localized").length, 4);
  const preview = await fetch(`${base}/api/jobs/${job.jobId}/debug/camera-0.png`, { headers }); assert.equal(preview.status, 200);
  const edited = { primaryColumn: "right", rotationDegrees: 0, anchors: uploads[0].anchors, exclusionRois: [] };
  assert.equal((await fetch(`${base}/api/calibrations/${runId}/uploads/${uploads[0].uploadId}`, { method: "PATCH", headers, body: JSON.stringify(edited) })).status, 200);
  const stale = await request(`/api/calibrations/${runId}/commit-map`, { runId, jobId: job.jobId, expectedMapRevision: 1 }, "POST", 409);
  assert.equal(stale.error.code, "STALE_GEOMETRY");
  await fetch(`${base}/api/calibrations/${runId}/uploads/${uploads[0].uploadId}`, { method: "PATCH", headers, body: JSON.stringify({ ...edited, primaryColumn: uploads[0].primaryColumn }) });
  await request(`/api/calibrations/${runId}/commit-map`, { runId, jobId: job.jobId, expectedMapRevision: 1 });
  current = await snapshot();
  assert.equal(current.audienceMap.mapRevision, 2);
  check("three actual MP4 uploads, real Python decode, annotated preview, stale geometry rejection and reviewed map commit");
  for (let index = 0; index < 4; index++) {
    current = await snapshot();
    const location = current.audienceMap.locations.find(location => location.deviceId === phones[index].id)!;
    assert.equal(location.status, "localized");
    const selected = selectRectangle(current.audienceMap.locations, { x: location.x! - 0.01, y: location.y! - 0.01 }, { x: location.x! + 0.01, y: location.y! + 0.01 }, current.audienceMap.mapRevision);
    assert.deepEqual(selected.deviceIds, [phones[index].id]);
    await request("/api/assignments", { expectedRevision: current.assignmentRevision, mapRevision: selected.mapRevision, deviceIds: selected.deviceIds, channelId: show.channels[index % show.channels.length].channelId, effectiveServerMs: current.serverMs + 2000 });
  }
  await until(snapshot, s => s.pendingActions.length === 0);
  current = await snapshot();
  await request("/api/transport", { expectedRevision: current.transport.transportRevision, action: "prepare", showRevision: current.show.showRevision, positionMs: 0, effectiveServerMs: 0 });
  await until(snapshot, s => s.preparations.find(p => p.domain === "transport")?.readyIds.length === 4);
  current = await snapshot();
  await request("/api/transport", { expectedRevision: current.transport.transportRevision, action: "play", showRevision: current.show.showRevision, positionMs: 0, effectiveServerMs: current.serverMs + 2000 });
  await until(snapshot, s => s.transport.status === "playing");
  await until(() => phones.every(phone => phone.calls.some(call => call.startsWith("transport:playing:"))), Boolean);
  assert.deepEqual(show.channels.map(channel => channel.label), ["Melody", "Vocals", "Percussion"]);
  check("decoded map selections route four intended phones across Melody, Vocals and Percussion and schedule a prepared common cue");
  const latePhone = new Phone(); latePhone.audioReady = false; phones.push(latePhone);
  await latePhone.connect();
  assert.equal(latePhone.snapshot!.transport.status, "stopped");
  latePhone.send("participant.column", { column: "center" });
  await until(() => { latePhone.status(); return latePhone.snapshot; }, s => s?.assignment.channelId === show.channels[1].channelId);
  assert.equal(latePhone.snapshot!.location.mappingMode, "manual-column");
  assert.equal(latePhone.snapshot!.location.x, null);
  assert.equal(latePhone.snapshot!.transport.status, "stopped", "An unready manual phone must remain silent");
  latePhone.audioReady = true; latePhone.status();
  await until(() => latePhone.snapshot, s => s?.transport.status === "playing");
  current = await snapshot();
  assert.deepEqual(latePhone.snapshot!.transport, current.transport);
  assert.equal(latePhone.control.view().channelId, show.channels[1].channelId);
  assert.ok(latePhone.control.view().positionMs > 2000, "A late manual phone joins the current playhead, not zero");
  assert.ok(latePhone.calls.includes("load"));
  const finalMapRevision = current.audienceMap.mapRevision;
  check("a fifth phone manually selects center, waits for audio readiness, and joins Vocals at the existing shared playhead");
  phones[1].audioReady = false; phones[1].status();
  current = await snapshot();
  const assignment = { expectedRevision: current.assignmentRevision, mapRevision: current.audienceMap.mapRevision, deviceIds: phones.slice(0, 2).map(phone => phone.id), channelId: show.channels[2].channelId, effectiveServerMs: current.serverMs + 6000 };
  const prep = await request("/api/assignments/prepare", assignment);
  await until(snapshot, s => { const p = s.preparations.find(p => p.domain === "assignment"); return !!p && p.readyIds.length + p.excluded.length === 2; });
  const switchAck = await request("/api/assignments", { ...assignment, preparationId: prep.preparationId });
  assert.equal(switchAck.ready, 1); assert.deepEqual(switchAck.excluded.map((item: { deviceId: number }) => item.deviceId), [phones[1].id]);
  current = await snapshot();
  await request("/api/mix", { expectedRevision: current.mix.mixRevision, masterGain: 0.3, channels: current.show.channels, effectiveServerMs: current.serverMs + 2000 });
  await until(snapshot, s => s.mix.masterGain === 0.3);
  phones[0].status(); await Bun.sleep(150);
  assert.ok(phones[0].calls.includes("mix:0.3"));
  await request("/api/panic", {});
  await until(snapshot, s => s.transport.status === "stopped" && s.pendingActions.length === 0);
  assert.ok(phones.every(phone => phone.calls.includes("panic")));
  check("live assignment readiness exclusions, scheduled mix recovery, immediate panic and cancellation");
  const oldEpoch = epoch, identities = phones.map(phone => phone.id);
  phones.forEach(phone => phone.close()); server!.kill(); await server!.exited;
  await startServer(); assert.notEqual(epoch, oldEpoch);
  await Promise.all(phones.map(phone => phone.connect()));
  current = await snapshot(); assert.equal(current.transport.status, "stopped"); assert.equal(current.audienceMap.mapRevision, finalMapRevision);
  assert.equal(current.assignments.find(item => item.deviceId === phones[0].id)?.channelId, show.channels[0].channelId, "Panic-cancelled assignments must not resurrect on restart");
  assert.deepEqual(phones.map(phone => phone.id), identities); assert.equal(current.show.showRevision, 1);
  assert.equal(latePhone.snapshot!.assignment.channelId, show.channels[1].channelId);
  assert.equal(latePhone.snapshot!.location.mappingMode, "manual-column");
  check("restart creates a fresh epoch, preserves identities/show/map/assignments, and stays stopped");
  const report = `# Local integrated software verification\n\nDate: ${new Date().toISOString()}\nDuration: ${((performance.now() - started) / 1000).toFixed(1)} s\n\n${checks.map(item => `- PASS: ${item}`).join("\n")}\n\nEvidence: real HTTP/WS and Python processing; generated MP4s are synthetic. Audio scheduling uses a recording double. No physical acoustic, phone, camera or venue claim. Runtime artifacts: ${directory}\n`;
  await mkdir(".devcontext/evidence/integration", { recursive: true });
  await writeFile(".devcontext/evidence/integration/local-e2e.md", report);
} finally { phones.forEach(phone => phone.close()); if (typeof server !== "undefined") server.kill(); }
