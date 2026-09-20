import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { AdminSnapshot, ServerMessage, Track } from "@orchestra/contracts";
import { ROOT, pythonExecutable } from "../../scripts/run";

// The supplied source copy must have been built for these isolated internal ports.
const appRoot = resolve(process.argv[2] ?? "runtime/railway-production-20260920");
assert(appRoot.startsWith(resolve(ROOT, "runtime") + "/") || appRoot.startsWith(resolve(ROOT, "runtime") + "\\"), "Use an isolated source copy inside runtime/.");
const data = resolve(appRoot, "verification", crypto.randomUUID());
await mkdir(data, { recursive: true });
const sessionId = "production-smoke", secret = crypto.randomUUID(), base = "http://127.0.0.1:13086";
const headers = { "x-operator-secret": secret, "content-type": "application/json" };
let child: ReturnType<typeof Bun.spawn> | undefined;
async function start() {
  child = Bun.spawn([process.execPath, resolve(appRoot, "scripts/start-production.ts")], { cwd: appRoot,
    env: { ...process.env, PORT: "13086", BACKEND_INTERNAL_URL: "http://127.0.0.1:18086", ADMIN_INTERNAL_URL: "http://127.0.0.1:13087",
      OPERATOR_SECRET: secret, SESSION_ID: sessionId, DATA_DIR: data, PYTHON: pythonExecutable(), NODE_ENV: "production" },
    stdout: Bun.file(resolve(data, "service.log")), stderr: Bun.file(resolve(data, "service-errors.log")),
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "Production launcher exited before readiness; inspect its isolated logs.");
    const ready = await fetch(`${base}/api/health`).then(response => response.ok).catch(() => false);
    if (ready) {
      const identity = await (await fetch(`${base}/api/session`)).json();
      assert.equal(identity.sessionId, sessionId, "Refusing to mutate an unexpected backend.");
      return identity;
    }
    await Bun.sleep(100);
  }
  throw new Error("Production startup timed out.");
}
async function stop() { child?.kill(); if (child) await child.exited; child = undefined; }
const snapshot = async () => AdminSnapshot.parse(await (await fetch(`${base}/control/api/sessions/${sessionId}/snapshot`, { headers })).json());
try {
  const identity = await start();
  for (const [path, text] of [["/", "Concerto"], ["/admin", "Admin password"], ["/present", "Scan to join"], ["/upload", "Upload password"]]) {
    const response = await fetch(`${base}${path}`); assert.equal(response.status, 200, path); assert((await response.text()).includes(text), path);
  }
  assert.equal((await fetch(`${base}/control/api/sessions/${sessionId}/snapshot`)).status, 401);
  const before = await snapshot();
  console.log("PASS production pages, loopback rewrites and operator authentication");
  const joined = await (await fetch(`${base}/api/sessions/${sessionId}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`${base.replace("http", "ws")}/ws?resumeToken=${encodeURIComponent(joined.resumeToken)}`);
    const timeout = setTimeout(() => { socket.close(); reject(new Error("WebSocket proxy did not return a clock reply.")); }, 10000);
    socket.onopen = () => socket.send(JSON.stringify({ protocolVersion: 1, sessionId, serverEpoch: identity.serverEpoch,
      messageId: crypto.randomUUID(), type: "clock.probe", payload: { t0: 0, probeGroupId: 0, probeGroupIndex: 0 } }));
    socket.onmessage = event => { const message = ServerMessage.parse(JSON.parse(String(event.data))); if (message.type === "clock.reply") { clearTimeout(timeout); socket.close(); resolve(); } };
    socket.onerror = () => { clearTimeout(timeout); socket.close(); reject(new Error("WebSocket proxy connection failed.")); };
  });
  console.log("PASS participant join and production WebSocket clock proxy");
  const bytes = Buffer.alloc(8044);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  const query = new URLSearchParams({ commandId: crypto.randomUUID(), label: "deployment-verification.wav", byteSize: String(bytes.length), durationMs: "250", sampleRateHz: "16000", channels: "1" });
  const upload = await fetch(`${base}/control/api/assets?${query}`, { method: "POST", headers: { "x-operator-secret": secret, "content-type": "audio/wav" }, body: bytes });
  assert.equal(upload.status, 200); const track = Track.parse(await upload.json());
  const lane = before.show.channels[0].channelId;
  const show = { ...before.show, label: "Production persistence verification", tracks: [track], clips: [{ clipId: "test-clip", channelId: lane, trackId: track.trackId, timelineStartMs: 0, sourceOffsetMs: 0, durationMs: 250, gain: 1 }],
    sectionChannels: { left: lane, "center-left": null, "center-right": lane, right: null } };
  const saved = await fetch(`${base}/control/api/show`, { method: "PUT", headers, body: JSON.stringify({ protocolVersion: 1, sessionId,
    serverEpoch: identity.serverEpoch, commandId: crypto.randomUUID(), expectedRevision: before.show.showRevision, show }) });
  assert.equal(saved.status, 200, await saved.text());
  const committed = await snapshot();
  await stop();
  const restarted = await start(); assert.notEqual(restarted.serverEpoch, identity.serverEpoch);
  const restored = await snapshot(); assert.deepEqual(restored.show, committed.show); assert.equal(restored.transport.status, "stopped");
  const downloaded = await fetch(`${base}${track.url}`); assert.equal(downloaded.status, 200);
  assert.equal(createHash("sha256").update(new Uint8Array(await downloaded.arrayBuffer())).digest("hex"), track.sha256);
  const resumed = await (await fetch(`${base}/api/sessions/${sessionId}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resumeToken: joined.resumeToken }) })).json();
  assert.equal(resumed.deviceId, joined.deviceId);
  console.log("PASS uploaded audio, saved four-section presets, identity and stopped state survive production restart");
} finally { await stop(); }
