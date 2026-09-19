import type { SynchronizedClock } from "@orchestra/sync";

type OutputClock = Pick<AudioContext, "currentTime" | "getOutputTimestamp">;

// Adapted from BeatSync perfTimeToAudioTime (MIT). This is the only output-clock
// mapping. Do not also subtract outputLatency or a manual nudge.
export function perfToAudioTime(ctx: OutputClock, perfMs: number, nowPerfMs = performance.now()): number {
  const ts = typeof ctx.getOutputTimestamp === "function" ? ctx.getOutputTimestamp() : {};
  if (ts.contextTime && ts.performanceTime) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
  return ctx.currentTime + (perfMs - nowPerfMs) / 1000;
}

export function serverMsToAudioTime(clock: SynchronizedClock, ctx: OutputClock, serverMs: number, nowPerfMs?: number): number {
  return perfToAudioTime(ctx, clock.toLocalPerformanceMs(serverMs), nowPerfMs);
}
