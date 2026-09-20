import { afterEach, expect, test } from "bun:test";
import type { ServerMessageData } from "@orchestra/contracts";
import { calibrationPacket } from "@orchestra/contracts/otc";
import { REPLACED_CLOSE_CODE as SERVER_REPLACED, startClientDemoServer } from "../../tools/client-demo/server";
import { CalibrationSession } from "../src/lib/calibration";
import { ShowControl } from "../src/lib/show-control";
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
  const refused = new WebSocket(`ws://127.0.0.1:${server.port}/ws?resumeToken=nope`);
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

test("a calibration run goes prepare → ready → arm → result through the real mock", async () => {
  server = startClientDemoServer({ port: 0, log: () => {} });
  const messages: ServerMessageData[] = [];
  const states: ConnectionState[] = [];
  let session: CalibrationSession | null = null;
  const connection = new ParticipantConnection({
    wsUrl: `ws://127.0.0.1:${server.port}/ws`,
    join: () => joinSession({ api: server!.url.toString(), sessionId: "demo", storage: memory() }),
    openSocket: browserSocket, log: () => {},
    onChange: state => states.push(state),
    onMessage: message => {
      messages.push(message);
      if (message.type === "calibration.prepare") session!.onPrepare(message, { foreground: true, clockUsable: true, optedOut: false });
      if (message.type === "calibration.arm") session!.onArm(message, performance.timeOrigin + performance.now());
    },
  });
  session = new CalibrationSession(message => { connection.send(message); }, () => {
    const state = states.at(-1);
    return state?.identity && state.snapshot ? { sessionId: state.snapshot.sessionId, serverEpoch: state.snapshot.serverEpoch, deviceId: state.identity.deviceId } : null;
  });
  connection.start();
  await until(() => states.at(-1)?.status.kind === "connected");

  const started = await (await fetch(new URL("/__mock__/calibrate?leadMs=2000&readyWaitMs=100", server.url), { method: "POST" })).json() as { runId: string; runTag: number; participantIds: number[] };
  expect(started.participantIds).toEqual([0]);
  await until(() => session!.phase.kind === "armed");
  const armed = session.phase;
  expect(armed.kind === "armed" && armed.packet).toEqual(calibrationPacket(0, started.runTag));
  // The renderer is covered separately; finish the run as it would.
  session.complete(3);
  const record = async () => ((await (await fetch(new URL("/__mock__/calibration", server!.url))).json()) as { ready: number[]; results: { completed: boolean }[] }[])[0];
  let run = await record();
  for (let i = 0; i < 50 && run.results.length === 0; i += 1) { await Bun.sleep(10); run = await record(); }
  expect(run.ready).toEqual([0]);
  expect(run.results).toEqual([{ deviceId: 0, completed: true, reason: null, maxFrameLatenessMs: 3 }] as never);
  expect(messages.map(message => message.type).filter(type => type.startsWith("calibration"))).toEqual(["calibration.prepare", "calibration.arm"]);
  connection.stop();
});

test("the mock refuses to calibrate with nobody connected", async () => {
  server = startClientDemoServer({ port: 0, log: () => {} });
  expect((await fetch(new URL("/__mock__/calibrate", server.url), { method: "POST" })).status).toBe(409);
});

test("assign, play, then reconnect mid-song rebuilds the same playhead from the mock's snapshot", async () => {
  server = startClientDemoServer({ port: 0, log: () => {} });
  const calls: string[] = [];
  const states: ConnectionState[] = [];
  const nowMs = () => performance.timeOrigin + performance.now();
  const identity = () => {
    const state = states.at(-1);
    return state?.identity && state.snapshot ? { sessionId: state.snapshot.sessionId, serverEpoch: state.snapshot.serverEpoch, deviceId: state.identity.deviceId } : null;
  };
  let connection: ParticipantConnection | null = null;
  const control = new ShowControl({
    send: message => { connection!.send(message); }, identity,
    facts: () => ({ audioRunning: true, audioOutputReady: true, clockUsable: true, verified: () => true }),
    preload: async () => {}, now: nowMs,
  });
  control.attach({
    load: (_s, transport, channelId) => calls.push(`load ${transport.status} ${channelId}`),
    setTransport: transport => calls.push(`transport ${transport.status}`),
    setChannel: channelId => calls.push(`channel ${channelId}`),
    setMix: () => calls.push("mix"), panic: () => calls.push("panic"),
    renewLease: () => calls.push("lease"), contextResumed: () => calls.push("resumed"),
  });
  let lastSnapshot: unknown = null;
  const storage = memory(); // one browser: the reconnect must resume the same device
  connection = new ParticipantConnection({
    wsUrl: `ws://127.0.0.1:${server.port}/ws`,
    join: () => joinSession({ api: server!.url.toString(), sessionId: "demo", storage }),
    openSocket: browserSocket, log: () => {},
    onChange: state => {
      states.push(state);
      if (state.status.kind !== "connected") control.disconnected();
      else if (state.snapshot && state.snapshot !== lastSnapshot) { lastSnapshot = state.snapshot; control.applySnapshot(state.snapshot); }
    },
    onMessage: message => control.handle(message),
  });
  connection.start();
  await until(() => states.at(-1)?.status.kind === "connected" && calls.includes("lease"));

  await fetch(new URL("/__mock__/assign?deviceId=0&channelId=channel-1&leadMs=200&readyWaitMs=100", server.url), { method: "POST" });
  await until(() => calls.includes("channel channel-1"));
  await fetch(new URL("/__mock__/transport?action=play&positionMs=0&leadMs=200&readyWaitMs=100", server.url), { method: "POST" });
  await until(() => calls.includes("transport playing"));
  const playback = await (await fetch(new URL("/__mock__/playback", server.url))).json() as { readies: { type: string; ready: boolean }[] };
  expect(playback.readies.map(item => `${item.type}:${item.ready}`)).toEqual(["assignment.ready:true", "transport.ready:true"]);
  await Bun.sleep(400); // both changes are now effective

  const before = control.view();
  const beforeAt = nowMs();
  await fetch(new URL("/__mock__/drop", server.url), { method: "POST" });
  await until(() => states.at(-1)?.status.kind === "reconnecting");
  await until(() => states.at(-1)?.status.kind === "connected", 3000);
  const after = control.view();
  const afterAt = nowMs();
  expect(states.at(-1)?.identity?.deviceId).toBe(0);
  expect(calls.filter(call => call.startsWith("load")).at(-1)).toBe("load playing channel-1");
  expect(after.channelId).toBe("channel-1");
  expect(after.transport?.transportRevision).toBe(before.transport?.transportRevision);
  // Same shared playhead: the position moved by exactly the time that passed during the reconnect.
  expect(after.positionMs - before.positionMs).toBeCloseTo(afterAt - beforeAt, -1);
  connection.stop();
});
