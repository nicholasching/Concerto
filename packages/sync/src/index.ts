// epochNow is extracted from BeatSync packages/shared/utils.ts (MIT).
// See THIRD_PARTY_NOTICES.md and .devcontext/beat-sync-extraction.md.
export const epochNow = (): number => performance.timeOrigin + performance.now();

export interface ClockQuality {
  ready: boolean;
  uncertaintyMs: number | null;
  sampleAgeMs: number | null;
}

// Team 1 implements the estimator/lifecycle behind this boundary.
export interface SynchronizedClock {
  nowServerMs(): number;
  toLocalPerformanceMs(serverMs: number): number;
  quality(): ClockQuality;
}
