import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ClientMessage, JoinResponse, ParticipantSnapshot, ServerMessage } from "@orchestra/contracts";

// Run against a running audience origin. Creates one test participant, but changes no show/routing.
const origin = new URL(process.argv[2] ?? "http://localhost:3000").origin;
const get = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(15000) });
const metadata = await get("/api/session");
assert(metadata.ok, "Audience proxy cannot reach /api/session. Start bun run dev:all.");
const { sessionId } = await metadata.json();
const identity = JoinResponse.parse(await (await get(`/api/sessions/${encodeURIComponent(sessionId)}/join`, {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}",
})).json());
const snapshot = ParticipantSnapshot.parse(await (await get(`/api/sessions/${encodeURIComponent(sessionId)}/snapshot`, {
  headers: { "x-resume-token": identity.resumeToken, "x-operator-secret": "must-not-grant-operator-role" },
})).json());
assert.equal(snapshot.deviceId, identity.deviceId);
console.log("PASS: join and participant snapshot through the audience origin");

assert.equal((await get("/api/transport", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
assert.equal((await get("/ws?operatorSecret=must-not-grant-operator-role")).status, 403);
console.log("PASS: operator mutations and operator sockets are not exposed by the audience proxy");

const socketUrl = new URL("/ws", origin); socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
socketUrl.searchParams.set("resumeToken", identity.resumeToken);
const socket = new WebSocket(socketUrl);
try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("Timed out waiting for the proxied clock reply")), 15000);
    const finish = (error?: Error) => { clearTimeout(timeout); if (error) reject(error); else resolve(); };
    socket.onerror = () => finish(new Error("Audience WebSocket proxy failed"));
    socket.onmessage = event => {
      try {
        const message = ServerMessage.parse(JSON.parse(String(event.data)));
        if (message.type === "state.snapshot") {
          assert.equal(message.payload.role, "participant");
          socket.send(JSON.stringify(ClientMessage.parse({ protocolVersion: 1, sessionId, serverEpoch: identity.serverEpoch,
            messageId: crypto.randomUUID(), type: "clock.probe", payload: { probeGroupId: 1, probeGroupIndex: 0, t0: performance.timeOrigin + performance.now() } })));
        } else if (message.type === "clock.reply") finish();
      } catch (cause) { finish(cause as Error); }
    };
  });
  console.log("PASS: WebSocket upgrade, initial snapshot and clock round trip");
} finally { socket.close(); }

const track = snapshot.show.tracks[0];
if (track) {
  const response = await get(track.url);
  assert(response.ok, "Audio asset failed through the audience origin");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(bytes.byteLength, track.byteSize);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), track.sha256);
  console.log("PASS: audio asset bytes and SHA-256 through the audience origin");
} else console.log("No show loaded: audio download check skipped. Use demo:seed to include it.");
console.log(`Verified ${origin}; test device ${identity.deviceId} is now disconnected. This is transport evidence, not a physical audio test.`);
