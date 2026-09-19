// Ported from BeatSync apps/client/src/utils/__tests__/ntp.test.ts and
// apps/server/src/__tests__/codedProbes.test.ts, plus epoch/age/reset cases this project adds.
import { describe, expect, spyOn, test } from "bun:test";
import {
  ClockEstimator,
  epochNow,
  isProbeGapPure,
  PROBE_CONSTANTS,
  selectMinRttOffset,
  type ClockMeasurement,
} from "../src";

const EPOCH = "epoch-a";
const { PROBE_GAP_MS, PROBE_GAP_TOLERANCE_MS, MAX_MEASUREMENTS } = PROBE_CONSTANTS;

class TestClock {
  constructor(public ms = 1_000_000) {}
  now = () => this.ms;
  advance(ms: number) {
    this.ms += ms;
  }
}

const measurement = (data: { roundTripDelayMs: number; clockOffsetMs: number }): ClockMeasurement => ({
  t0: 1000,
  t1: 1000 + data.clockOffsetMs + data.roundTripDelayMs / 2,
  t2: 1000 + data.clockOffsetMs + data.roundTripDelayMs / 2,
  t3: 1000 + data.roundTripDelayMs,
  ...data,
});

interface Leg {
  serverOffsetMs: number;
  upMs?: number;
  downMs?: number;
  serverEpoch?: string;
}

const probe = (estimator: ClockEstimator, clock: TestClock, groupId: number, index: 0 | 1, leg: Leg) => {
  const t0 = clock.now();
  clock.advance(leg.upMs ?? 5);
  const t1 = clock.now() + leg.serverOffsetMs;
  clock.advance(leg.downMs ?? 5);
  return estimator.accept({
    serverEpoch: leg.serverEpoch ?? EPOCH,
    probeGroupId: groupId,
    probeGroupIndex: index,
    t0,
    t1,
    t2: t1,
  });
};

// One coded pair with a matching client inter-departure and server inter-arrival gap.
const purePair = (estimator: ClockEstimator, clock: TestClock, leg: Leg) => {
  const groupId = estimator.beginProbeGroup();
  probe(estimator, clock, groupId, 0, leg);
  clock.advance(PROBE_GAP_MS);
  return probe(estimator, clock, groupId, 1, leg);
};

describe("selectMinRttOffset", () => {
  test("selects the offset of the minimum-RTT measurement", () => {
    const result = selectMinRttOffset([
      measurement({ roundTripDelayMs: 10, clockOffsetMs: 100 }),
      measurement({ roundTripDelayMs: 20, clockOffsetMs: 110 }),
      measurement({ roundTripDelayMs: 200, clockOffsetMs: 500 }),
      measurement({ roundTripDelayMs: 300, clockOffsetMs: 800 }),
    ]);
    expect(result.offsetMs).toBe(100);
    expect(result.minRoundTripMs).toBe(10);
    expect(result.averageRoundTripMs).toBe(132.5);
  });

  test("ignores high-RTT spikes entirely", () => {
    const result = selectMinRttOffset([
      measurement({ roundTripDelayMs: 18, clockOffsetMs: 149 }),
      measurement({ roundTripDelayMs: 22, clockOffsetMs: 151 }),
      measurement({ roundTripDelayMs: 20, clockOffsetMs: 150 }),
      measurement({ roundTripDelayMs: 500, clockOffsetMs: 350 }),
      measurement({ roundTripDelayMs: 800, clockOffsetMs: -150 }),
    ]);
    expect(result.offsetMs).toBe(149);
  });

  test("handles negative offsets when the client is ahead of the server", () => {
    const result = selectMinRttOffset([
      measurement({ roundTripDelayMs: 12, clockOffsetMs: -48 }),
      measurement({ roundTripDelayMs: 10, clockOffsetMs: -50 }),
      measurement({ roundTripDelayMs: 15, clockOffsetMs: -55 }),
      measurement({ roundTripDelayMs: 500, clockOffsetMs: -200 }),
    ]);
    expect(result.offsetMs).toBe(-50);
  });

  test("handles a single measurement", () => {
    const result = selectMinRttOffset([measurement({ roundTripDelayMs: 50, clockOffsetMs: 200 })]);
    expect(result.offsetMs).toBe(200);
    expect(result.averageRoundTripMs).toBe(50);
  });
});

describe("isProbeGapPure", () => {
  test("accepts an exactly matching gap", () => {
    expect(isProbeGapPure({ t0First: 1000, t0Second: 1005, t1First: 2000, t1Second: 2005 })).toBe(true);
  });

  test("accepts a late send whose gap is preserved end to end", () => {
    expect(isProbeGapPure({ t0First: 1000, t0Second: 1008, t1First: 2000, t1Second: 2008 })).toBe(true);
  });

  test("accepts both tolerance boundaries", () => {
    expect(
      isProbeGapPure({ t0First: 1000, t0Second: 1005, t1First: 2000, t1Second: 2005 + PROBE_GAP_TOLERANCE_MS }),
    ).toBe(true);
    expect(
      isProbeGapPure({ t0First: 1000, t0Second: 1005, t1First: 2000, t1Second: 2005 - PROBE_GAP_TOLERANCE_MS }),
    ).toBe(true);
  });

  test("rejects a queued second probe", () => {
    expect(
      isProbeGapPure({ t0First: 1000, t0Second: 1005, t1First: 2000, t1Second: 2005 + PROBE_GAP_TOLERANCE_MS + 1 }),
    ).toBe(false);
  });

  test("rejects a queued first probe", () => {
    expect(
      isProbeGapPure({ t0First: 1000, t0Second: 1005, t1First: 2000, t1Second: 2005 - PROBE_GAP_TOLERANCE_MS - 1 }),
    ).toBe(false);
  });

  test("rejects a massively distorted gap", () => {
    expect(isProbeGapPure({ t0First: 1000, t0Second: 1005, t1First: 2000, t1Second: 2050 })).toBe(false);
  });
});

describe("ClockEstimator", () => {
  test("recovers a positive offset when the server clock is ahead", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 0 });
    purePair(estimator, clock, { serverOffsetMs: 250 });
    expect(estimator.nowServerMs() - clock.now()).toBe(250);
  });

  test("recovers a negative offset when the client clock is ahead", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 0 });
    purePair(estimator, clock, { serverOffsetMs: -120 });
    expect(estimator.nowServerMs() - clock.now()).toBe(-120);
  });

  test("keeps the low-RTT offset when a later pair is delayed", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 0 });
    purePair(estimator, clock, { serverOffsetMs: 250, upMs: 5, downMs: 5 });
    purePair(estimator, clock, { serverOffsetMs: 250, upMs: 200, downMs: 200 });
    expect(estimator.nowServerMs() - clock.now()).toBe(250);
    expect(estimator.stats().pairsPure).toBe(2);
  });

  test("reports asymmetric delay as offset error rather than hiding it", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 0 });
    purePair(estimator, clock, { serverOffsetMs: 250, upMs: 60, downMs: 10 });
    // A one-way asymmetry of (up - down) biases the estimate by half of it. Min-RTT
    // selection cannot detect this; it is the documented limit of the estimator.
    expect(estimator.nowServerMs() - clock.now()).toBe(250 + 25);
  });

  test("rejects a pair whose second probe was queued on the way up", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 0 });
    const groupId = estimator.beginProbeGroup();
    probe(estimator, clock, groupId, 0, { serverOffsetMs: 250 });
    clock.advance(PROBE_GAP_MS);
    const accepted = probe(estimator, clock, groupId, 1, {
      serverOffsetMs: 250,
      upMs: 5 + PROBE_GAP_TOLERANCE_MS + 1,
    });
    expect(accepted).toBeNull();
    expect(estimator.stats()).toMatchObject({ pairsPure: 0, pairsImpure: 1, measurements: 0 });
    expect(estimator.quality().ready).toBe(false);
  });

  test("an unmatched second probe does not consume the buffered first probe", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 0 });
    const groupId = estimator.beginProbeGroup();
    probe(estimator, clock, groupId, 0, { serverOffsetMs: 250 });
    expect(probe(estimator, clock, groupId + 99, 1, { serverOffsetMs: 250 })).toBeNull();
    clock.advance(PROBE_GAP_MS);
    expect(probe(estimator, clock, groupId, 1, { serverOffsetMs: 250 })).not.toBeNull();
    expect(estimator.stats().pairsPure).toBe(1);
  });

  test("reset clears the estimate but never reuses a probe group ID", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 0 });
    purePair(estimator, clock, { serverOffsetMs: 250 });
    const nextGroupId = estimator.beginProbeGroup();

    estimator.reset();

    expect(estimator.nowServerMs()).toBe(clock.now());
    expect(estimator.quality()).toEqual({ ready: false, uncertaintyMs: null, sampleAgeMs: null });
    expect(estimator.stats()).toMatchObject({ pairsPure: 0, measurements: 0, serverEpoch: null });
    expect(estimator.beginProbeGroup()).toBeGreaterThan(nextGroupId);
  });

  test("a new server epoch discards measurements taken under the old one", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 0, minMeasurements: 1 });
    purePair(estimator, clock, { serverOffsetMs: 250 });
    expect(estimator.quality().ready).toBe(true);

    probe(estimator, clock, estimator.beginProbeGroup(), 0, { serverOffsetMs: 9000, serverEpoch: "epoch-b" });

    expect(estimator.stats()).toMatchObject({ measurements: 0, serverEpoch: "epoch-b" });
    expect(estimator.quality().ready).toBe(false);
    expect(estimator.nowServerMs()).toBe(clock.now());
  });

  test("readiness expires as the newest sample ages", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 0, minMeasurements: 1, maxSampleAgeMs: 3750 });
    purePair(estimator, clock, { serverOffsetMs: 250 });
    expect(estimator.quality()).toMatchObject({ ready: true, sampleAgeMs: 0, uncertaintyMs: 5 });

    clock.advance(3750);
    expect(estimator.quality()).toMatchObject({ ready: true, sampleAgeMs: 3750 });

    clock.advance(1);
    expect(estimator.quality()).toMatchObject({ ready: false, sampleAgeMs: 3751 });
  });

  test("stays unready while the round trip is too noisy to meet the threshold", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({
      now: clock.now,
      timeOriginMs: 0,
      minMeasurements: 1,
      readyUncertaintyMs: 20,
    });
    purePair(estimator, clock, { serverOffsetMs: 250, upMs: 60, downMs: 60 });
    expect(estimator.quality()).toMatchObject({ ready: false, uncertaintyMs: 60 });
  });

  test("requires the configured number of measurements before reporting ready", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 0 });
    for (let i = 0; i < MAX_MEASUREMENTS - 1; i++) purePair(estimator, clock, { serverOffsetMs: 250 });
    expect(estimator.quality().ready).toBe(false);
    purePair(estimator, clock, { serverOffsetMs: 250 });
    expect(estimator.quality().ready).toBe(true);
  });

  test("keeps a bounded sliding window of measurements", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 0 });
    for (let i = 0; i < MAX_MEASUREMENTS + 5; i++) purePair(estimator, clock, { serverOffsetMs: 250 });
    expect(estimator.stats().measurements).toBe(MAX_MEASUREMENTS);
  });

  test("reprobes rapidly until the window is full, then settles", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 0 });
    expect(estimator.nextProbeDelayMs()).toBe(PROBE_CONSTANTS.INITIAL_INTERVAL_MS);
    for (let i = 0; i < MAX_MEASUREMENTS; i++) purePair(estimator, clock, { serverOffsetMs: 250 });
    expect(estimator.nextProbeDelayMs()).toBe(PROBE_CONSTANTS.STEADY_STATE_INTERVAL_MS);
  });

  test("converts server time to the local performance domain without an audio nudge", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 500 });
    purePair(estimator, clock, { serverOffsetMs: 250 });
    const targetServerMs = clock.now() + 250 + 3000;
    expect(estimator.toLocalPerformanceMs(targetServerMs)).toBe(clock.now() + 3000 - 500);
  });

  test("clamps wait time for a target that has already passed", () => {
    const clock = new TestClock();
    const estimator = new ClockEstimator({ now: clock.now, timeOriginMs: 0 });
    purePair(estimator, clock, { serverOffsetMs: 250 });
    expect(estimator.waitTimeMs(estimator.nowServerMs() + 500)).toBe(500);
    expect(estimator.waitTimeMs(estimator.nowServerMs() - 500)).toBe(0);
  });

  test("a wall-clock jump does not move the estimate", () => {
    const estimator = new ClockEstimator();
    const groupId = estimator.beginProbeGroup();
    const first = epochNow();
    estimator.accept({ serverEpoch: EPOCH, probeGroupId: groupId, probeGroupIndex: 0, t0: first, t1: first + 1000, t2: first + 1000 });
    const second = epochNow();
    estimator.accept({ serverEpoch: EPOCH, probeGroupId: groupId, probeGroupIndex: 1, t0: second, t1: second + 1000, t2: second + 1000 });

    const before = estimator.nowServerMs();
    const wall = spyOn(Date, "now").mockReturnValue(1);
    try {
      const after = estimator.nowServerMs();
      expect(after).toBeGreaterThanOrEqual(before);
      expect(after - before).toBeLessThan(1000);
    } finally {
      wall.mockRestore();
    }
  });
});
