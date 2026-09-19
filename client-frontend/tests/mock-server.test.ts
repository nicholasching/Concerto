import { afterEach, expect, test } from "bun:test";
import { REPLACED_CLOSE_CODE as SERVER_REPLACED, startClientDemoServer } from "../../tools/client-demo/server";
import { browserSocket, ParticipantConnection, REPLACED_CLOSE_CODE, type ConnectionState } from "../src/lib/connection";
import { joinSession, type KeyValueStore } from "../src/lib/join";
import { buildReadiness, statusMessage } from "../src/lib/readiness";

// End-to-end against the synthetic Team 2 mock: real HTTP, real WebSockets, fake nothing.
let server: ReturnType<typeof startClientDemoServer> | null = null;
afterEach(() => { server?.stop(true); server = null; });

function memory(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
const until = async (check: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(5); }
};
function client(storage: KeyValueStore) {
  const states: ConnectionState[] = [];
  const connection = new ParticipantConnection({
    wsUrl: `ws://127.0.0.1:${server!.port}/ws`,
    join: () => joinSession({ api: server!.url.toString(), sessionId: "demo", storage }),
    openSocket: browserSocket, onChange: state => states.push(state), log: () => {},
  });
  return { connection, states, last: () => states.at(-1)! };
}

test("the client and mock agree on the replaced close code", () => {
  expect(SERVER_REPLACED).toBe(REPLACED_CLOSE_CODE);
});

test("join, resume, bad token and capacity follow the documented contract", async () => {
  server = startClientDemoServer({ port: 0, capacity: 3, log: () => {} });
  const api = server.url.toString();
  const first = memory();
  const a = await joinSession({ api, sessionId: "demo", storage: first });
  expect(a).toMatchObject({ status: "joined", join: { deviceId: 0 } });
  expect(await joinSession({ api, sessionId: "demo", storage: first })).toMatchObject({ status: "joined", newDevice: false, join: { deviceId: 0 } });
  expect(await joinSession({ api, sessionId: "demo", storage: memory() })).toMatchObject({ join: { deviceId: 1 } });
  const stale = memory();
  stale.setItem("orchestra:resume:demo", "z".repeat(32));
  expect(await joinSession({ api, sessionId: "demo", storage: stale })).toMatchObject({ status: "joined", tokenRejected: true, join: { deviceId: 2 } });
  expect(await joinSession({ api, sessionId: "demo", storage: memory() })).toEqual({ status: "full" });
});

test("a real connection receives its snapshot, reports readiness and survives drop and restart", async () => {
  server = startClientDemoServer({ port: 0, log: () => {} });
  const { connection, last } = client(memory());
  connection.start();
  await until(() => last().status.kind === "connected");
  const identity = last().identity!;
  expect(last().snapshot?.deviceId).toBe(identity.deviceId);

  const readiness = buildReadiness(identity.deviceId, { connected: true, foreground: false, clock: null, audioState: "running", verifiedHashes: {} });
  expect(connection.send(statusMessage(last().snapshot!, readiness))).toBe(true);
  const device = async () => ((await (await fetch(new URL("/__mock__/devices", server!.url))).json()) as { deviceId: number; foreground: boolean; audioUnlocked: boolean; connected: boolean }[])[0];
  let reported = await device();
  for (let i = 0; i < 50 && reported.foreground; i += 1) { await Bun.sleep(10); reported = await device(); }
  expect(reported).toMatchObject({ deviceId: 0, foreground: false, audioUnlocked: true, connected: true });

  await fetch(new URL("/__mock__/drop", server.url), { method: "POST" });
  await until(() => last().status.kind === "reconnecting");
  await until(() => last().status.kind === "connected", 3000);
  expect(last().identity?.deviceId).toBe(identity.deviceId);

  const epochBefore = last().snapshot!.serverEpoch;
  await fetch(new URL("/__mock__/restart", server.url), { method: "POST" });
  await until(() => last().status.kind === "connected" && last().snapshot!.serverEpoch !== epochBefore, 3000);
  expect(last().identity?.deviceId).toBe(identity.deviceId);
  connection.stop();
});

test("a second tab with the same identity replaces the first", async () => {
  server = startClientDemoServer({ port: 0, log: () => {} });
  const shared = memory();
  const tabA = client(shared);
  tabA.connection.start();
  await until(() => tabA.last().status.kind === "connected");
  const tabB = client(shared);
  tabB.connection.start();
  await until(() => tabB.last().status.kind === "connected");
  await until(() => tabA.last().status.kind === "replaced");
  expect(tabB.last().identity?.deviceId).toBe(tabA.last().identity?.deviceId);
  tabA.connection.stop();
  tabB.connection.stop();
});

test("the mock refuses a socket with an unknown token and a status for another device", async () => {
  server = startClientDemoServer({ port: 0, log: () => {} });
  const refused = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=nope`);
  const closed = await new Promise<number>(resolve => { refused.onclose = event => resolve(event.code); });
  expect(closed).not.toBe(1000);

  const { connection, last } = client(memory());
  connection.start();
  await until(() => last().status.kind === "connected");
  const spoof = buildReadiness(last().identity!.deviceId + 1, { connected: true, foreground: true, clock: null, audioState: null, verifiedHashes: {} });
  connection.send(statusMessage(last().snapshot!, spoof));
  await until(() => last().status.kind === "reconnecting");
  connection.stop();
});
