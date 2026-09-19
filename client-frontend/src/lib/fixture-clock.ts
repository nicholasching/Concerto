import { epochNow, type SynchronizedClock } from "@orchestra/sync";

// DEVELOPMENT ONLY. Treats this device's own clock as server time (offset 0).
// It is not synchronized with anything; replace with Team 1's estimator.
export const fixtureClock: SynchronizedClock = {
  nowServerMs: epochNow,
  toLocalPerformanceMs: serverMs => serverMs - performance.timeOrigin,
  quality: () => ({ ready: false, uncertaintyMs: null, sampleAgeMs: null }),
};
