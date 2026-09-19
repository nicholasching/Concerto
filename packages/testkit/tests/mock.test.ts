import { expect, test } from "bun:test";
import { ServerMessage, ParticipantSnapshot, type ServerMessageData } from "@orchestra/contracts";
import { createDemoSnapshot, participantSnapshot } from "../src";
import { startMockServer } from "../src/mock-server";

test("1500-device fixture has unique valid IDs and a role-filtered snapshot", () => {
  const admin = createDemoSnapshot(1500);
  expect(new Set(admin.devices.map(device => device.deviceId)).size).toBe(1500);
  const participant = participantSnapshot(admin, 1499);
  expect(participant.deviceId).toBe(1499);
  expect("devices" in participant).toBe(false);
  expect(() => createDemoSnapshot(2049)).toThrow();
});
test("mock HTTP is marked and serves the actual hashed test media", async () => {
  const server = startMockServer(0);
  try {
    const response = await fetch(new URL("/api/sessions/demo/snapshot?role=participant", server.url));
    expect(response.headers.get("X-Orchestra-Mock")).toBe("1");
    const snapshot = ParticipantSnapshot.parse(await response.json());
    const media = await fetch(new URL(snapshot.show.tracks[0].url, server.url));
    const bytes = new Uint8Array(await media.arrayBuffer());
    expect(bytes.byteLength).toBe(snapshot.show.tracks[0].byteSize);
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(snapshot.show.tracks[0].sha256);
  } finally { server.stop(true); }
});
test("mock WebSocket supplies a typed snapshot and a correlated clock reply", async () => {
  const server = startMockServer(0);
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?deviceId=0`);
  try {
    const reply = await new Promise<ServerMessageData>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Mock socket timeout")), 4000);
      socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Socket error")); });
      socket.addEventListener("message", event => {
        try {
          const message = ServerMessage.parse(JSON.parse(String(event.data)));
          if (message.type === "state.snapshot") socket.send(JSON.stringify({ protocolVersion: 1, sessionId: message.sessionId, serverEpoch: message.serverEpoch, messageId: "probe-test", type: "clock.probe", payload: { t0: 12345, probeGroupId: 7, probeGroupIndex: 1 } }));
          if (message.type === "clock.reply") { clearTimeout(timeout); resolve(message); }
        } catch (error) { clearTimeout(timeout); reject(error); }
      });
    });
    if (reply.type !== "clock.reply") throw new Error("Expected clock reply");
    expect(reply.payload.t0).toBe(12345); expect(reply.payload.probeGroupId).toBe(7);
    expect(reply.payload.t2).toBeGreaterThanOrEqual(reply.payload.t1);
  } finally { socket.close(); server.stop(true); }
});
