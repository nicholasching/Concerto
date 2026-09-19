import { expect, test } from "bun:test";
import { ClientMessage } from "@orchestra/contracts";
import { buildReadiness, statusMessage, StatusReporter, type DeviceReadinessData, type LocalReadiness } from "../src/lib/readiness";

const HASH = "a".repeat(64);
const local = (patch: Partial<LocalReadiness> = {}): LocalReadiness => ({ connected: true, foreground: true, clock: null, audioState: null, verifiedHashes: {}, ...patch });

test("a connected socket alone is not audio-ready", () => {
  const readiness = buildReadiness(0, local());
  expect(readiness).toMatchObject({ deviceId: 0, connected: true, audioUnlocked: false, clockReady: false, decodedTrackHashes: {} });
});

test("audio is unlocked only while the context is running", () => {
  expect(buildReadiness(1, local({ audioState: "running" })).audioUnlocked).toBe(true);
  expect(buildReadiness(1, local({ audioState: "interrupted" })).audioUnlocked).toBe(false);
  expect(buildReadiness(1, local({ audioState: "suspended" })).audioUnlocked).toBe(false);
});

test("clock fields come from clock quality and stay null without a clock", () => {
  expect(buildReadiness(1, local())).toMatchObject({ clockReady: false, clockUncertaintyMs: null, clockSampleAgeMs: null });
  expect(buildReadiness(1, local({ clock: { ready: true, uncertaintyMs: 4, sampleAgeMs: 120 } }))).toMatchObject({ clockReady: true, clockUncertaintyMs: 4, clockSampleAgeMs: 120 });
});

test("the status message validates against the shared contract", () => {
  const message = statusMessage({ sessionId: "demo", serverEpoch: "epoch" }, buildReadiness(0, local({ verifiedHashes: { "tone-0": HASH } })));
  expect(ClientMessage.parse(message)).toMatchObject({ type: "device.status", payload: { deviceId: 0, decodedTrackHashes: { "tone-0": HASH } } });
});

function harness(accept = true) {
  const sent: DeviceReadinessData[] = [];
  let now = 0;
  const pending: (() => void)[] = [];
  const reporter = new StatusReporter(readiness => { if (accept) sent.push(readiness); return accept; },
    { setTimeout: callback => { pending.push(callback); return pending.length; }, clearTimeout: () => { pending.length = 0; } },
    () => now, 500);
  return { sent, reporter, advance: (ms: number) => { now += ms; }, fire: () => pending.splice(0).forEach(callback => callback()) };
}

test("a burst of changes collapses to one immediate send and one trailing send", () => {
  const { sent, reporter, advance, fire } = harness();
  reporter.update(buildReadiness(0, local({ foreground: true })));
  reporter.update(buildReadiness(0, local({ foreground: false })));
  reporter.update(buildReadiness(0, local({ foreground: true, audioState: "running" })));
  expect(sent).toHaveLength(1);
  advance(500);
  fire();
  expect(sent).toHaveLength(2);
  expect(sent[1].audioUnlocked).toBe(true);
});

test("unchanged readiness is not resent until reset", () => {
  const { sent, reporter, advance, fire } = harness();
  reporter.update(buildReadiness(0, local()));
  advance(1000);
  reporter.update(buildReadiness(0, local()));
  fire();
  expect(sent).toHaveLength(1);
  reporter.reset();
  reporter.update(buildReadiness(0, local()));
  expect(sent).toHaveLength(2);
});

test("a failed send is not recorded as sent", () => {
  const { reporter, sent } = harness(false);
  reporter.update(buildReadiness(0, local()));
  expect(sent).toHaveLength(0);
});
