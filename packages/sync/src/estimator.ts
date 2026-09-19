// Coded probe pairing, min-RTT selection and the probe constants are extracted from BeatSync
// apps/client/src/utils/ntp.ts, apps/client/src/store/global.tsx and packages/shared/constants.ts (MIT).
// Retained behavior and deliberate differences are recorded in .devcontext/beat-sync-extraction.md.
import { epochNow, type ClockQuality, type SynchronizedClock } from "./epoch";

export const PROBE_CONSTANTS = {
  PROBE_GAP_MS: 25,
  PROBE_GAP_TOLERANCE_MS: 5,
  MAX_MEASUREMENTS: 16,
  INITIAL_INTERVAL_MS: 50,
  STEADY_STATE_INTERVAL_MS: 2500,
  RESPONSE_TIMEOUT_MS: 3750,
} as const;

export const READY_UNCERTAINTY_MS = 20;

export interface ClockMeasurement {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
  roundTripDelayMs: number;
  clockOffsetMs: number;
}

export interface ClockReply {
  serverEpoch: string;
  probeGroupId: number;
  probeGroupIndex: 0 | 1;
  t0: number;
  t1: number;
  t2: number;
}

export interface ProbeStats {
  probeGroupsStarted: number;
  pairsPure: number;
  pairsImpure: number;
  measurements: number;
  serverEpoch: string | null;
}

export interface ClockEstimatorOptions {
  now?: () => number;
  timeOriginMs?: number;
  maxMeasurements?: number;
  minMeasurements?: number;
  readyUncertaintyMs?: number;
  maxSampleAgeMs?: number;
}

export const isProbeGapPure = (gap: { t0First: number; t0Second: number; t1First: number; t1Second: number }): boolean =>
  Math.abs(gap.t1Second - gap.t1First - (gap.t0Second - gap.t0First)) <= PROBE_CONSTANTS.PROBE_GAP_TOLERANCE_MS;

// Queuing only adds to round-trip delay, so the lowest-RTT sample carries the least
// asymmetric contamination (RFC 5905 section 10). Spikes get no weight at all.
export const selectMinRttOffset = (measurements: readonly ClockMeasurement[]) => {
  let minRoundTripMs = Infinity;
  let offsetMs = 0;
  for (const measurement of measurements) {
    if (measurement.roundTripDelayMs < minRoundTripMs) {
      minRoundTripMs = measurement.roundTripDelayMs;
      offsetMs = measurement.clockOffsetMs;
    }
  }
  const total = measurements.reduce((sum, measurement) => sum + measurement.roundTripDelayMs, 0);
  return {
    offsetMs,
    minRoundTripMs,
    averageRoundTripMs: measurements.length > 0 ? total / measurements.length : 0,
  };
};

export class ClockEstimator implements SynchronizedClock {
  private readonly now: () => number;
  private readonly timeOriginMs: number;
  private readonly maxMeasurements: number;
  private readonly minMeasurements: number;
  private readonly readyUncertaintyMs: number;
  private readonly maxSampleAgeMs: number;

  private measurements: ClockMeasurement[] = [];
  private pendingFirst: ClockMeasurement | null = null;
  private pendingGroupId: number | null = null;
  private probeGroupCounter = 0;
  private pairsPure = 0;
  private pairsImpure = 0;
  private serverEpoch: string | null = null;
  private offsetMs = 0;
  private minRoundTripMs: number | null = null;
  private lastAcceptedAtMs: number | null = null;

  constructor(options: ClockEstimatorOptions = {}) {
    this.now = options.now ?? epochNow;
    this.timeOriginMs = options.timeOriginMs ?? performance.timeOrigin;
    this.maxMeasurements = options.maxMeasurements ?? PROBE_CONSTANTS.MAX_MEASUREMENTS;
    this.minMeasurements = options.minMeasurements ?? PROBE_CONSTANTS.MAX_MEASUREMENTS;
    this.readyUncertaintyMs = options.readyUncertaintyMs ?? READY_UNCERTAINTY_MS;
    this.maxSampleAgeMs = options.maxSampleAgeMs ?? PROBE_CONSTANTS.RESPONSE_TIMEOUT_MS;
  }

  // The counter never restarts, so a reply that outlives a reset cannot match a new group.
  beginProbeGroup(): number {
    return this.probeGroupCounter++;
  }

  accept(reply: ClockReply): ClockMeasurement | null {
    const t3 = this.now();
    if (this.serverEpoch !== null && this.serverEpoch !== reply.serverEpoch) this.reset();
    this.serverEpoch = reply.serverEpoch;

    const measurement: ClockMeasurement = {
      t0: reply.t0,
      t1: reply.t1,
      t2: reply.t2,
      t3,
      clockOffsetMs: (reply.t1 - reply.t0 + (reply.t2 - t3)) / 2,
      roundTripDelayMs: t3 - reply.t0 - (reply.t2 - reply.t1),
    };

    if (reply.probeGroupIndex === 0) {
      this.pendingFirst = measurement;
      this.pendingGroupId = reply.probeGroupId;
      return null;
    }

    const first = this.pendingFirst;
    if (!first || this.pendingGroupId !== reply.probeGroupId) return null;
    this.pendingFirst = null;
    this.pendingGroupId = null;

    const pure = isProbeGapPure({
      t0First: first.t0,
      t0Second: measurement.t0,
      t1First: first.t1,
      t1Second: measurement.t1,
    });
    if (!pure) {
      this.pairsImpure++;
      return null;
    }

    this.pairsPure++;
    const best = first.roundTripDelayMs <= measurement.roundTripDelayMs ? first : measurement;
    this.measurements.push(best);
    if (this.measurements.length > this.maxMeasurements) this.measurements.shift();
    const estimate = selectMinRttOffset(this.measurements);
    this.offsetMs = estimate.offsetMs;
    this.minRoundTripMs = estimate.minRoundTripMs;
    this.lastAcceptedAtMs = t3;
    return best;
  }

  reset(): void {
    this.measurements = [];
    this.pendingFirst = null;
    this.pendingGroupId = null;
    this.pairsPure = 0;
    this.pairsImpure = 0;
    this.offsetMs = 0;
    this.minRoundTripMs = null;
    this.lastAcceptedAtMs = null;
    this.serverEpoch = null;
  }

  nowServerMs(): number {
    return this.now() + this.offsetMs;
  }

  toLocalPerformanceMs(serverMs: number): number {
    return serverMs - this.offsetMs - this.timeOriginMs;
  }

  waitTimeMs(targetServerMs: number): number {
    return Math.max(0, targetServerMs - this.nowServerMs());
  }

  // Interval only; callers add jitter and own the reprobe timer.
  nextProbeDelayMs(): number {
    return this.measurements.length < this.maxMeasurements
      ? PROBE_CONSTANTS.INITIAL_INTERVAL_MS
      : PROBE_CONSTANTS.STEADY_STATE_INTERVAL_MS;
  }

  // Uncertainty is half the best observed round trip: a quality signal under symmetric
  // delay, not a bound on true clock error when the path is asymmetric.
  quality(): ClockQuality {
    if (this.minRoundTripMs === null || this.lastAcceptedAtMs === null) {
      return { ready: false, uncertaintyMs: null, sampleAgeMs: null };
    }
    const uncertaintyMs = this.minRoundTripMs / 2;
    const sampleAgeMs = this.now() - this.lastAcceptedAtMs;
    return {
      ready:
        this.measurements.length >= this.minMeasurements &&
        uncertaintyMs <= this.readyUncertaintyMs &&
        sampleAgeMs <= this.maxSampleAgeMs,
      uncertaintyMs,
      sampleAgeMs,
    };
  }

  stats(): ProbeStats {
    return {
      probeGroupsStarted: this.probeGroupCounter,
      pairsPure: this.pairsPure,
      pairsImpure: this.pairsImpure,
      measurements: this.measurements.length,
      serverEpoch: this.serverEpoch,
    };
  }
}
