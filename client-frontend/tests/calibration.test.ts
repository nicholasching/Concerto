import { beforeEach, expect, test } from "bun:test";
import { ClientMessage, type ClientMessageData } from "@orchestra/contracts";
import { calibrationPacket } from "@orchestra/contracts/otc";
import goldens from "../../packages/contracts/generated/otc-golden-packets.json";
import { CalibrationSession, slotAt, symbolColor, type ArmMessage, type CalibrationIdentity, type CalibrationPhase, type Eligibility, type PrepareMessage } from "../src/lib/calibration";
import { COUNTDOWN_HIDE_MS, FlashRenderer, type FrameScheduler } from "../src/lib/flash-renderer";

const PALETTE = { zero: "#FFB000", one: "#0066FF", neutral: "#111111" };
const me: CalibrationIdentity = { sessionId: "demo", serverEpoch: "epoch-1", deviceId: 7 };
const plan = {
  protocolVersion: 1 as const, sessionId: "demo", serverEpoch: "epoch-1", runId: "run-1", runTag: 37, participantIds: [3, 7, 9],
  packetVersion: "otc-v1" as const, codebookVersion: "hamming16-11-v1" as const, paletteVersion: "amber-blue-v1", palette: PALETTE, symbolMs: 200 as const,
};
const START = 100_000;
const envelope = { protocolVersion: 1 as const, sessionId: "demo", serverEpoch: "epoch-1", messageId: "m" };
const prepare = (patch: Partial<typeof plan> = {}, preparationId = "prep-1"): PrepareMessage =>
  ({ ...envelope, type: "calibration.prepare", revision: 2, payload: { preparationId, plan: { ...plan, ...patch } } });
const arm = (patch: Partial<typeof plan> = {}, preparationId = "prep-1", startServerMs = START): ArmMessage =>
  ({ ...envelope, type: "calibration.arm", revision: 3, effectiveServerMs: startServerMs, payload: { preparationId, run: { ...plan, ...patch, startServerMs } } });
const eligible: Eligibility = { foreground: true, clockUsable: true, optedOut: false };

let sent: ClientMessageData[];
let phases: CalibrationPhase[];
let session: CalibrationSession;
beforeEach(() => {
  sent = [];
  phases = [];
  session = new CalibrationSession(message => sent.push(ClientMessage.parse(message)), () => me, phase => phases.push(phase));
});
const results = () => sent.filter(message => message.type === "calibration.result").map(message => message.payload);

test("slotAt is negative before the start and derived from absolute time", () => {
  expect(slotAt(START - 1, START, 200)).toBe(-1);
  expect(slotAt(START, START, 200)).toBe(0);
  expect(slotAt(START + 199.9, START, 200)).toBe(0);
  expect(slotAt(START + 200, START, 200)).toBe(1);
  expect(slotAt(START + 54 * 200 + 199, START, 200)).toBe(54);
  expect(slotAt(START + 55 * 200, START, 200)).toBe(55);
});

test("symbolColor maps guards to neutral and bits to the plan palette", () => {
  expect([null, 0, 1].map(symbol => symbolColor(symbol as null | 0 | 1, PALETTE))).toEqual(["#111111", "#FFB000", "#0066FF"]);
});

test("a participant that is eligible says ready and arms for the matching run", () => {
  session.onPrepare(prepare(), eligible);
  expect(sent[0]).toMatchObject({ type: "calibration.ready", payload: { preparationId: "prep-1", ready: true, reason: null, runId: "run-1" } });
  session.onArm(arm(), START - 3000);
  expect(session.phase).toMatchObject({ kind: "armed", run: { startServerMs: START } });
  expect(session.phase.kind === "armed" && session.phase.packet).toEqual(calibrationPacket(7, 37));
});

test("ineligible phones say not ready with the reason and never arm", () => {
  for (const [eligibility, reason] of [[{ ...eligible, optedOut: true }, "opted-out"], [{ ...eligible, foreground: false }, "hidden"], [{ ...eligible, clockUsable: false }, "clock"]] as const) {
    sent = [];
    session.onPrepare(prepare(), eligibility);
    expect(sent[0]).toMatchObject({ payload: { ready: false, reason } });
    session.onArm(arm(), START - 3000);
    expect(session.phase.kind).toBe("idle");
  }
});

test("a prepare for another device set, session or epoch is ignored", () => {
  session.onPrepare(prepare({ participantIds: [1, 2] }), eligible);
  session.onPrepare({ ...prepare(), sessionId: "other" }, eligible);
  session.onPrepare(prepare({ serverEpoch: "old-epoch" }), eligible);
  expect(sent).toHaveLength(0);
  expect(session.phase.kind).toBe("idle");
});

test("a stale or mismatched arm is ignored", () => {
  session.onPrepare(prepare(), eligible);
  session.onArm(arm({}, "prep-old"), START - 3000);
  session.onArm(arm({ runTag: 38 }), START - 3000);
  session.onArm(arm({ palette: { ...PALETTE, one: "#FF0000" } }), START - 3000);
  session.onArm({ ...arm(), effectiveServerMs: START + 1 }, START - 3000);
  session.onArm({ ...arm(), serverEpoch: "old-epoch" }, START - 3000);
  expect(session.phase.kind).toBe("prepared");
});

test("an arm that arrives after the start never flashes and reports late once", () => {
  session.onPrepare(prepare(), eligible);
  session.onArm(arm(), START);
  expect(results()).toEqual([{ runId: "run-1", completed: false, maxFrameLatenessMs: 0, reason: "late" }]);
  expect(phases.some(phase => phase.kind === "armed")).toBe(false);
});

test("each abort reason during a run reports once, and later events report nothing", () => {
  for (const reason of ["hidden", "clock", "disconnected", "opted-out"] as const) {
    sent = [];
    session.onPrepare(prepare(), eligible);
    session.onArm(arm(), START - 3000);
    session.abort(reason);
    session.abort(reason);
    session.complete(5);
    expect(results()).toEqual([{ runId: "run-1", completed: false, maxFrameLatenessMs: 0, reason }]);
  }
});

test("a newer prepare supersedes the running packet", () => {
  session.onPrepare(prepare(), eligible);
  session.onArm(arm(), START - 3000);
  session.onPrepare(prepare({ runId: "run-2", runTag: 38 }, "prep-2"), eligible);
  expect(results()).toEqual([{ runId: "run-1", completed: false, maxFrameLatenessMs: 0, reason: "superseded" }]);
  expect(session.phase).toMatchObject({ kind: "prepared", preparationId: "prep-2" });
});

test("skipping while prepared withdraws the earlier yes", () => {
  session.onPrepare(prepare(), eligible);
  session.abort("opted-out");
  expect(sent.at(-1)).toMatchObject({ type: "calibration.ready", payload: { ready: false, reason: "opted-out", runId: "run-1" } });
  expect(session.phase.kind).toBe("idle");
});

test("a completed run reports its lateness diagnostic once", () => {
  session.onPrepare(prepare(), eligible);
  session.onArm(arm(), START - 3000);
  session.complete(12.5);
  session.complete(99);
  expect(results()).toEqual([{ runId: "run-1", completed: true, maxFrameLatenessMs: 12.5, reason: null }]);
});

// Renderer: a fake clock and frame queue stand in for requestAnimationFrame.
function rendererHarness(deviceId: number, runTag: number, clockUsable = () => true) {
  const clock = { now: START - 2500, nowServerMs() { return this.now; }, toLocalPerformanceMs: (ms: number) => ms, quality: () => ({ ready: true, uncertaintyMs: 0, sampleAgeMs: 0 }) };
  let queued: (() => void) | null = null;
  const frames: FrameScheduler = { request: callback => { queued = callback; return 1; }, cancel: () => { queued = null; } };
  const painted: { color: string; text: string | null }[] = [];
  const outcome: { done: number | null; clockLost: boolean } = { done: null, clockLost: false };
  const run = { ...plan, runTag, participantIds: [deviceId], startServerMs: START };
  const renderer = new FlashRenderer({
    clock, clockUsable, run, packet: calibrationPacket(deviceId, runTag), frames,
    paint: (color, text) => painted.push({ color, text }),
    onDone: ms => { outcome.done = ms; }, onClockLost: () => { outcome.clockLost = true; },
  });
  const frameAt = (now: number) => { clock.now = now; const next = queued; queued = null; next?.(); return painted.at(-1)!; };
  return { renderer, frameAt, painted, outcome, hasQueued: () => queued !== null };
}
const toSymbol = (color: string) => color === PALETTE.neutral ? null : color === PALETTE.zero ? 0 : 1;

test("the rendered sequence matches every golden packet at slot midpoints", () => {
  for (const golden of goldens) {
    const { renderer, frameAt, outcome } = rendererHarness(golden.deviceId, golden.runTag);
    renderer.start();
    const seen = golden.symbols.map((_, slot) => toSymbol(frameAt(START + slot * golden.symbolMs + golden.symbolMs / 2).color));
    expect(seen as (number | null)[]).toEqual(golden.symbols);
    frameAt(START + golden.symbols.length * golden.symbolMs);
    expect(outcome.done).not.toBeNull();
  }
});

test("nothing but neutral appears before the start, with the countdown hidden in the last second", () => {
  const { renderer, frameAt } = rendererHarness(1, 37);
  renderer.start();
  expect(frameAt(START - 2500)).toEqual({ color: PALETTE.neutral, text: expect.stringContaining("Starting in 3") });
  expect(frameAt(START - COUNTDOWN_HIDE_MS + 1)).toEqual({ color: PALETTE.neutral, text: null });
  expect(frameAt(START - 0.001)).toEqual({ color: PALETTE.neutral, text: null });
});

test("skipped frames jump to the correct slot and do not shift later slots", () => {
  const packet = calibrationPacket(1, 37);
  const { renderer, frameAt, outcome } = rendererHarness(1, 37);
  renderer.start();
  frameAt(START + 3 * 200 + 10);
  expect(toSymbol(frameAt(START + 10 * 200 + 10).color)).toBe(packet[10]);
  expect(toSymbol(frameAt(START + 11 * 200 + 10).color)).toBe(packet[11]);
  expect(toSymbol(frameAt(START + 40 * 200 + 10).color)).toBe(packet[40]);
  frameAt(START + 56 * 200);
  // Two skips: slot 4 was due at +800 and first drawn at +2010 (1210 ms late); slot 12 was due
  // at +2400 and the next frame came at +8010 (5610 ms late). The diagnostic is the worst one.
  expect(outcome.done).toBeCloseTo(8010 - 2400, 6);
});

test("the renderer stops and reports when the clock becomes unusable", () => {
  let usable = true;
  const { renderer, frameAt, painted, outcome, hasQueued } = rendererHarness(1, 37, () => usable);
  renderer.start();
  frameAt(START + 100);
  const count = painted.length;
  usable = false;
  frameAt(START + 300);
  expect(outcome.clockLost).toBe(true);
  expect(painted).toHaveLength(count);
  expect(hasQueued()).toBe(false);
});

test("stop cancels the next frame so nothing is painted after an abort", () => {
  const { renderer, frameAt, painted, hasQueued } = rendererHarness(1, 37);
  renderer.start();
  frameAt(START + 100);
  renderer.stop();
  expect(hasQueued()).toBe(false);
  const count = painted.length;
  frameAt(START + 300);
  expect(painted).toHaveLength(count);
});
