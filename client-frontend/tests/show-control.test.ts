import { beforeEach, expect, test } from "bun:test";
import { ClientMessage, ParticipantSnapshot, type ClientMessageData, type ParticipantSnapshotData, type ServerMessageData } from "@orchestra/contracts";
import type { TransportData } from "@orchestra/audio";
import fixture from "../../fixtures/participant-snapshot.json";
import { ShowControl, type Engine, type PlaybackFacts } from "../src/lib/show-control";

const T0 = 100_000;
const base = ParticipantSnapshot.parse(structuredClone(fixture));
const me = { sessionId: base.sessionId, serverEpoch: base.serverEpoch, deviceId: base.deviceId };
const envelope = { protocolVersion: 1 as const, sessionId: base.sessionId, serverEpoch: base.serverEpoch, messageId: "m", revision: 5 };
const playing = (revision: number, startServerMs: number, positionMs = 0): TransportData => ({ status: "playing", transportRevision: revision, showRevision: 1, positionMs, startServerMs });

let now: number;
let sent: ClientMessageData[];
let calls: [string, ...unknown[]][];
let facts: PlaybackFacts;
let control: ShowControl;
const engine: Engine = {
  load: (_show, transport, channelId) => { calls.push(["load", transport.transportRevision, channelId]); },
  setTransport: (transport, at) => { calls.push(["transport", transport.transportRevision, at]); },
  setChannel: (channelId, at) => { calls.push(["channel", channelId, at]); },
  setMix: (mix, at) => { calls.push(["mix", mix.masterGain, at]); },
  panic: () => { calls.push(["panic"]); },
  renewLease: at => { calls.push(["lease", at]); },
  contextResumed: () => { calls.push(["resumed"]); },
};

beforeEach(() => {
  now = T0;
  sent = [];
  calls = [];
  facts = { audioRunning: true, clockUsable: true, verified: () => true };
  control = new ShowControl({ send: message => sent.push(ClientMessage.parse(message)), identity: () => me, facts: () => facts, preload: async () => {}, now: () => now });
  control.applySnapshot(base);
  control.attach(engine);
  calls = [];
});

const transportCommit = (transport: TransportData, at: number): ServerMessageData =>
  ({ ...envelope, type: "transport.commit", effectiveServerMs: at, payload: { commandId: `c${transport.transportRevision}`, effectiveServerMs: at, supersedesCommandId: null, domain: "transport", transport } });
const assignmentCommit = (channelId: string | null, revision: number, at: number, deviceId = me.deviceId): ServerMessageData =>
  ({ ...envelope, type: "assignment.commit", effectiveServerMs: at, payload: { commandId: `a${revision}`, effectiveServerMs: at, supersedesCommandId: null, domain: "assignment", assignments: [{ deviceId, channelId, assignmentRevision: revision, mapRevision: 1 }] } });
const lastReply = () => sent.at(-1)!;

test("snapshot recovery schedules missed commits without reloading the engine or lease", () => {
  const snapshot: ParticipantSnapshotData = { ...structuredClone(base), pendingActions: [
    { commandId: "t", effectiveServerMs: T0 + 2000, supersedesCommandId: null, domain: "transport", transport: playing(1, T0 + 2000) },
    { commandId: "a", effectiveServerMs: T0 + 3000, supersedesCommandId: null, domain: "assignment", assignments: [{ deviceId: me.deviceId, channelId: "channel-2", assignmentRevision: 1, mapRevision: 1 }] },
  ] };
  control.handle({ ...envelope, type: "lease.renew", payload: { expiresServerMs: T0 + 10_000 } });
  control.applySnapshot(snapshot);
  expect(calls).toEqual([["lease", T0 + 10_000], ["transport", 1, T0 + 2000], ["channel", "channel-2", T0 + 3000]]);
});

test("transport.prepare checks audio, clock, show revision and decoded tracks", () => {
  const prepare = (showRevision = 1): ServerMessageData => ({ ...envelope, type: "transport.prepare", payload: { preparationId: "p", showRevision, transportRevision: 1 } });
  control.handle(prepare());
  expect(lastReply()).toMatchObject({ type: "transport.ready", payload: { preparationId: "p", ready: true, reason: null, showRevision: 1, transportRevision: 1 } });
  control.handle(prepare(2));
  expect(lastReply().payload).toMatchObject({ ready: false, reason: "show-mismatch" });
  facts.clockUsable = false;
  control.handle(prepare());
  expect(lastReply().payload).toMatchObject({ ready: false, reason: "clock" });
  facts.audioRunning = false;
  control.handle(prepare());
  expect(lastReply().payload).toMatchObject({ ready: false, reason: "audio-locked" });
});

test("assignment.prepare answers only for this device and checks the target channel's tracks", () => {
  facts.verified = trackId => trackId !== "tone-2";
  const prepare = (channelId: string, deviceId = me.deviceId): ServerMessageData => ({ ...envelope, type: "assignment.prepare", payload: { preparationId: "p", assignment: { deviceId, channelId, assignmentRevision: 4, mapRevision: 1 } } });
  control.handle(prepare("channel-1", me.deviceId + 1));
  expect(sent).toHaveLength(0);
  control.handle(prepare("channel-1"));
  expect(lastReply()).toMatchObject({ type: "assignment.ready", payload: { ready: true, assignmentRevision: 4 } });
  control.handle(prepare("channel-2"));
  expect(lastReply().payload).toMatchObject({ ready: false, reason: "assets-missing" });
});

test("assets.prepare preloads, then reports only verified hashes", async () => {
  facts.verified = trackId => trackId === "tone-0";
  control.handle({ ...envelope, type: "assets.prepare", payload: { preparationId: "p", show: base.show } });
  await Bun.sleep(0);
  expect(lastReply()).toMatchObject({ type: "assets.ready", payload: { ready: false, reason: "assets-missing", showRevision: 1, trackHashes: { "tone-0": base.show.tracks[0].sha256 } } });
  expect(Object.keys((lastReply().payload as { trackHashes: object }).trackHashes)).toEqual(["tone-0"]);
});

test("commits apply once, in revision order; older or repeated revisions are ignored", () => {
  control.handle(transportCommit(playing(2, T0 + 1000), T0 + 1000));
  control.handle(transportCommit(playing(2, T0 + 1000), T0 + 1000));
  control.handle(transportCommit(playing(1, T0 + 500), T0 + 500));
  control.handle(assignmentCommit("channel-1", 3, T0 + 2000));
  control.handle(assignmentCommit("channel-2", 2, T0 + 2500));
  control.handle(assignmentCommit("channel-2", 9, T0 + 2500, me.deviceId + 1));
  expect(calls).toEqual([["transport", 2, T0 + 1000], ["channel", "channel-1", T0 + 2000]]);
});

test("a pending change is shown as pending until its time, then as effective", () => {
  control.handle(transportCommit(playing(1, T0 + 2000), T0 + 2000));
  control.handle(assignmentCommit("channel-1", 1, T0 + 3000));
  expect(control.view()).toMatchObject({ transport: { status: "stopped" }, channelId: null, pendingTransport: { atServerMs: T0 + 2000 }, pendingChannel: { value: "channel-1" } });
  now = T0 + 4500;
  expect(control.view()).toMatchObject({ transport: { status: "playing" }, channelId: "channel-1", positionMs: 2500, pendingTransport: null, pendingChannel: null });
});

test("a newer mix doesn't cancel a pending transport change", () => {
  control.handle(transportCommit(playing(1, T0 + 2000), T0 + 2000));
  control.handle({ ...envelope, type: "mix.commit", effectiveServerMs: T0 + 1000, payload: { commandId: "m1", effectiveServerMs: T0 + 1000, supersedesCommandId: null, domain: "mix", mixRevision: 1, masterGain: 0.4, channels: base.show.channels } });
  expect(calls).toEqual([["transport", 1, T0 + 2000], ["mix", 0.4, T0 + 1000]]);
  expect(control.view().pendingTransport).not.toBeNull();
});

test("effective mix snapshots and duplicate scheduled commits never reload or restart the transport", () => {
  const cue = transportCommit(playing(2, T0 + 4000), T0 + 4000);
  control.handle(cue);
  if (cue.type !== "transport.commit") throw new Error("transport");
  control.applySnapshot({ ...base, pendingActions: [cue.payload] });
  control.handle(cue);
  expect(calls.filter(call => call[0] === "transport")).toHaveLength(1);
  now = T0 + 5000;
  control.applySnapshot({ ...base, transport: cue.payload.transport, mix: { masterGain: 0.3, mixRevision: 1 } });
  expect(calls.filter(call => call[0] === "load")).toHaveLength(0);
  expect(calls.filter(call => call[0] === "transport")).toHaveLength(1);
  expect(calls.at(-1)).toEqual(["mix", 0.3, now]);
});

test("after panic only a newer transport revision can play, even from a snapshot", () => {
  control.handle(transportCommit(playing(3, T0 - 1000), T0 - 1000));
  control.handle({ ...envelope, type: "panic", payload: { commandId: "p" } });
  expect(calls.at(-1)).toEqual(["panic"]);
  expect(control.view()).toMatchObject({ panicked: true });
  control.handle(transportCommit(playing(3, T0 + 1000), T0 + 1000));
  control.applySnapshot({ ...structuredClone(base), transport: playing(3, T0 - 1000) });
  expect(calls.at(-1)).toEqual(["transport", 3, T0]);
  expect(control.view()).toMatchObject({ transport: { status: "stopped" }, panicked: true });
  control.handle(transportCommit(playing(4, T0 + 2000), T0 + 2000));
  expect(calls.at(-1)).toEqual(["transport", 4, T0 + 2000]);
  now = T0 + 2500;
  expect(control.view()).toMatchObject({ transport: { status: "playing", transportRevision: 4 }, panicked: false });
});

test("a reconnecting phone recovers the authoritative master gain", () => {
  control.handle({ ...envelope, type: "mix.commit", effectiveServerMs: T0, payload: { commandId: "m1", effectiveServerMs: T0, supersedesCommandId: null, domain: "mix", mixRevision: 1, masterGain: 0.25, channels: base.show.channels } });
  const loads: number[] = [];
  control.attach({ ...engine, load: (_show, _transport, _channel, mix) => { loads.push(mix.masterGain); } });
  control.applySnapshot({ ...structuredClone(base), mix: { masterGain: 0.25, mixRevision: 1 } });
  expect(loads.at(-1)).toBe(0.25);
});

test("messages go out only with an identity and pass the shared schema", () => {
  const silent = new ShowControl({ send: message => sent.push(message), identity: () => null, facts: () => facts, preload: async () => {}, now: () => now });
  silent.handle({ ...envelope, type: "transport.prepare", payload: { preparationId: "p", showRevision: 1, transportRevision: 1 } });
  expect(sent).toHaveLength(0);
});

test("telemetry snapshots do not interrupt or recreate playing source nodes", () => {
  const snapshot = { ...structuredClone(base), transport: playing(7, T0 - 1000) };
  control.applySnapshot(snapshot);
  calls = [];
  control.applySnapshot({ ...structuredClone(snapshot), revision: snapshot.revision + 1, serverMs: T0 + 100,
    readiness: { ...snapshot.readiness, clockSampleAgeMs: 10 } });
  expect(calls).toEqual([]);
});

test("a server restart clears panic revisions and previous audio lease", () => {
  control.handle(transportCommit(playing(20, T0), T0));
  control.handle({ ...envelope, type: "panic", payload: { commandId: "p" } });
  control.applySnapshot({ ...structuredClone(base), serverEpoch: "replacement" });
  calls = [];
  control.handle(transportCommit(playing(1, T0 + 3000), T0 + 3000));
  expect(calls).toEqual([["transport", 1, T0 + 3000]]);
  expect(control.view().panicked).toBe(false);
});
