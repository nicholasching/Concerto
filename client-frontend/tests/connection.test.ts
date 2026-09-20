import { beforeEach, expect, test } from "bun:test";
import { ParticipantSnapshot, type ParticipantSnapshotData } from "@orchestra/contracts";
import fixture from "../../fixtures/participant-snapshot.json";
import { acceptSnapshot, BACKOFF, backoffDelayMs, ParticipantConnection, REPLACED_CLOSE_CODE, socketUrl, type ConnectionState, type SocketLike, type Timers } from "../src/lib/connection";
import type { JoinResult } from "../src/lib/join";

const TOKEN = "t".repeat(32);
const base = ParticipantSnapshot.parse(structuredClone(fixture));
const snapshotFor = (patch: Partial<ParticipantSnapshotData> = {}): ParticipantSnapshotData => ({ ...structuredClone(base), ...patch });
const joined = (patch: Partial<Extract<JoinResult, { status: "joined" }>> = {}): JoinResult => ({
  status: "joined", newDevice: false, tokenRejected: false,
  join: { protocolVersion: 1, sessionId: base.sessionId, serverEpoch: base.serverEpoch, deviceId: base.deviceId, resumeToken: TOKEN, revision: base.revision },
  ...patch,
});
const snapshotMessage = (snapshot: ParticipantSnapshotData) => JSON.stringify({
  protocolVersion: 1, sessionId: snapshot.sessionId, serverEpoch: snapshot.serverEpoch, messageId: crypto.randomUUID(),
  type: "state.snapshot", revision: snapshot.revision, payload: snapshot,
});

class FakeSocket implements SocketLike {
  readyState = 1;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(readonly url: string) {}
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; }
  receive(data: string) { this.onmessage?.({ data }); }
  serverClose(code: number) { this.readyState = 3; this.onclose?.({ code }); }
}

class FakeTimers implements Timers {
  private next = 1;
  pending = new Map<number, { callback: () => void; ms: number }>();
  setTimeout(callback: () => void, ms: number) { const id = this.next++; this.pending.set(id, { callback, ms }); return id; }
  clearTimeout(handle: unknown) { this.pending.delete(handle as number); }
  delays() { return [...this.pending.values()].map(timer => timer.ms); }
  runAll() { const due = [...this.pending.entries()]; this.pending.clear(); for (const [, timer] of due) timer.callback(); }
}

let sockets: FakeSocket[];
let timers: FakeTimers;
let states: ConnectionState[];
let joins: JoinResult[];
let logs: string[];

function create() {
  return new ParticipantConnection({
    wsUrl: "ws://mock/ws",
    join: async () => joins.shift() ?? joined(),
    openSocket: url => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    onChange: state => states.push(state),
    timers, random: () => 0, log: message => logs.push(message),
  });
}
const settle = () => Bun.sleep(0);
const last = () => states.at(-1)!;

test("an audience reset clears identity and stays disconnected even after network wake or retry", async () => {
  const connection = create(); connection.start(); await settle();
  sockets[0].receive(snapshotMessage(snapshotFor()));
  sockets[0].serverClose(4002);
  expect(last().status.kind).toBe("reset"); expect(last().identity).toBeNull(); expect(last().snapshot).toBeNull();
  connection.wake(); connection.retry(); timers.runAll(); await settle();
  expect(sockets).toHaveLength(1); expect(timers.pending.size).toBe(0);
});

beforeEach(() => { sockets = []; timers = new FakeTimers(); states = []; joins = []; logs = []; });

test("joins, opens a token-bound socket and connects on its own snapshot", async () => {
  const connection = create();
  connection.start();
  await settle();
  expect(sockets[0].url).toBe(`ws://mock/ws?resumeToken=${TOKEN}`);
  expect(last().status.kind).toBe("joining");
  sockets[0].receive(snapshotMessage(snapshotFor()));
  expect(last().status).toEqual({ kind: "connected" });
  expect(last().snapshot?.deviceId).toBe(base.deviceId);
  expect(timers.delays()).toEqual([BACKOFF.receiveTimeoutMs]);
});

test("drops invalid messages and snapshots for another device", async () => {
  const connection = create();
  connection.start();
  await settle();
  sockets[0].receive("not json");
  sockets[0].receive(JSON.stringify({ type: "state.snapshot" }));
  sockets[0].receive(snapshotMessage(snapshotFor({ deviceId: base.deviceId + 1 })));
  expect(last().status.kind).toBe("joining");
  expect(logs).toHaveLength(3);
});

test("ignores an older revision in the same epoch and accepts a new epoch", async () => {
  const connection = create();
  connection.start();
  await settle();
  sockets[0].receive(snapshotMessage(snapshotFor({ revision: 5 })));
  sockets[0].receive(snapshotMessage(snapshotFor({ revision: 4 })));
  expect(last().snapshot?.revision).toBe(5);
  sockets[0].receive(snapshotMessage(snapshotFor({ revision: 1, serverEpoch: "restarted-epoch" })));
  expect(last().snapshot).toMatchObject({ revision: 1, serverEpoch: "restarted-epoch" });
});

test("acceptSnapshot keeps revisions monotonic within an epoch only", () => {
  expect(acceptSnapshot(null, snapshotFor())).toBe(true);
  expect(acceptSnapshot(snapshotFor({ revision: 3 }), snapshotFor({ revision: 3 }))).toBe(true);
  expect(acceptSnapshot(snapshotFor({ revision: 3 }), snapshotFor({ revision: 2 }))).toBe(false);
  expect(acceptSnapshot(snapshotFor({ revision: 3 }), snapshotFor({ revision: 0, serverEpoch: "new" }))).toBe(true);
});

test("a dropped socket reconnects with backoff, re-resumes and takes the fresh snapshot", async () => {
  const connection = create();
  connection.start();
  await settle();
  sockets[0].receive(snapshotMessage(snapshotFor({ revision: 2 })));
  sockets[0].serverClose(1012);
  expect(last().status).toEqual({ kind: "reconnecting", attempt: 1 });
  expect(timers.delays()).toEqual([BACKOFF.initialMs]);
  timers.runAll();
  await settle();
  expect(sockets).toHaveLength(2);
  sockets[1].receive(snapshotMessage(snapshotFor({ revision: 3 })));
  expect(last()).toMatchObject({ status: { kind: "connected" }, snapshot: { revision: 3 } });
});

test("backoff grows by 1.1x, caps at 10 s, adds up to 15% jitter", () => {
  expect(backoffDelayMs(1, () => 0)).toBe(1000);
  expect(backoffDelayMs(2, () => 0)).toBeCloseTo(1100, 6);
  expect(backoffDelayMs(100, () => 0)).toBe(10000);
  expect(backoffDelayMs(1, () => 1)).toBeCloseTo(1150, 6);
});

test("gives up after the attempt limit and a tap retries from scratch", async () => {
  joins = Array.from({ length: BACKOFF.maxAttempts }, () => ({ status: "error", message: "down" }) as JoinResult);
  const connection = create();
  connection.start();
  for (let i = 0; i < BACKOFF.maxAttempts; i += 1) { await settle(); timers.runAll(); }
  await settle();
  expect(last().status).toEqual({ kind: "gave-up" });
  connection.retry();
  await settle();
  expect(sockets).toHaveLength(1);
});

test("a socket that never delivers a snapshot is abandoned after the connect timeout", async () => {
  const connection = create();
  connection.start();
  await settle();
  expect(timers.delays()).toEqual([BACKOFF.connectTimeoutMs]);
  timers.runAll();
  expect(sockets[0].closed).toBe(true);
  expect(last().status).toEqual({ kind: "reconnecting", attempt: 1 });
  expect(timers.delays()).toEqual([BACKOFF.initialMs]);
});

test("a connected socket that goes silent without a close event is resumed", async () => {
  const connection = create();
  connection.start();
  await settle();
  sockets[0].receive(snapshotMessage(snapshotFor()));
  // A network change can leave the browser believing a dead socket is still OPEN.
  timers.runAll();
  expect(sockets[0].closed).toBe(true);
  expect(last().status).toEqual({ kind: "reconnecting", attempt: 1 });
  timers.runAll();
  await settle();
  expect(sockets).toHaveLength(2);
  sockets[1].receive(snapshotMessage(snapshotFor({ revision: 3 })));
  expect(last()).toMatchObject({ status: { kind: "connected" }, identity: { deviceId: base.deviceId }, snapshot: { revision: 3 } });
  connection.stop();
});

test("validated traffic renews liveness even when clock quality may be poor", async () => {
  const connection = create();
  connection.start();
  await settle();
  sockets[0].receive(snapshotMessage(snapshotFor()));
  const firstTimer = [...timers.pending.keys()][0];
  const lease = { protocolVersion: 1, sessionId: base.sessionId, serverEpoch: base.serverEpoch,
    messageId: "lease", type: "lease.renew", payload: { expiresServerMs: 10000 } };
  sockets[0].receive(JSON.stringify(lease));
  expect(timers.pending.has(firstTimer)).toBe(false);
  expect(timers.delays()).toEqual([BACKOFF.receiveTimeoutMs]);
  const liveTimer = [...timers.pending.keys()][0];
  sockets[0].receive("invalid JSON");
  sockets[0].receive(JSON.stringify({ ...lease, serverEpoch: "stale-epoch" }));
  expect([...timers.pending.keys()]).toEqual([liveTimer]);
  expect(last().status.kind).toBe("connected");
  connection.stop();
  expect(timers.pending.size).toBe(0);
});

test("waking reconnects immediately while disconnected, not while connected", async () => {
  const connection = create();
  connection.start();
  await settle();
  sockets[0].receive(snapshotMessage(snapshotFor()));
  connection.wake();
  await settle();
  expect(sockets).toHaveLength(1);
  sockets[0].serverClose(1006);
  connection.wake();
  await settle();
  expect(sockets).toHaveLength(2);
  expect(timers.delays()).toEqual([BACKOFF.connectTimeoutMs]);
});

test("a replaced connection stops reconnecting until the user taps", async () => {
  const connection = create();
  connection.start();
  await settle();
  sockets[0].receive(snapshotMessage(snapshotFor()));
  sockets[0].serverClose(REPLACED_CLOSE_CODE);
  expect(last().status).toEqual({ kind: "replaced" });
  expect(timers.pending.size).toBe(0);
  connection.wake();
  await settle();
  expect(sockets).toHaveLength(1);
  connection.retry();
  await settle();
  expect(sockets).toHaveLength(2);
});

test("a full session stops without retrying", async () => {
  joins = [{ status: "full" }];
  const connection = create();
  connection.start();
  await settle();
  expect(last().status).toEqual({ kind: "full" });
  expect(timers.pending.size).toBe(0);
  expect(sockets).toHaveLength(0);
});

test("a rejected token surfaces a notice", async () => {
  joins = [joined({ newDevice: true, tokenRejected: true })];
  create().start();
  await settle();
  expect(last().notice).toContain("new device");
});

test("send only works on a connected, open socket; stop closes and ignores late events", async () => {
  const connection = create();
  const message = { protocolVersion: 1 as const, sessionId: base.sessionId, serverEpoch: base.serverEpoch, messageId: "m", type: "device.status" as const, payload: base.readiness };
  connection.start();
  await settle();
  expect(connection.send(message)).toBe(false);
  sockets[0].receive(snapshotMessage(snapshotFor()));
  expect(connection.send(message)).toBe(true);
  connection.stop();
  expect(sockets[0].closed).toBe(true);
  const count = states.length;
  sockets[0].serverClose(1006);
  expect(states).toHaveLength(count);
  expect(timers.pending.size).toBe(0);
});

test("socketUrl adds the token to the configured socket URL", () => {
  expect(socketUrl("ws://host:1/ws", "abc")).toBe("ws://host:1/ws?resumeToken=abc");
});
