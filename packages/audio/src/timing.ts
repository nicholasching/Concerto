import type { SynchronizedClock } from "@orchestra/sync";

type OutputClock = Pick<AudioContext, "currentTime"> & Partial<Pick<AudioContext, "getOutputTimestamp" | "baseLatency" | "outputLatency">>;

function outputTimestamp(ctx: OutputClock): { contextTime: number; performanceTime: number } | null {
  const ts = ctx.getOutputTimestamp?.();
  return ts && Number.isFinite(ts.contextTime) && Number.isFinite(ts.performanceTime)
    && ts.contextTime! > 0 && ts.performanceTime! > 0
    ? { contextTime: ts.contextTime!, performanceTime: ts.performanceTime! } : null;
}

const latency = (seconds: number | undefined) => Number.isFinite(seconds) && seconds! > 0 ? seconds! : 0;

/** Running alone is insufficient: the output clock must advance and settle after unlock/resume. */
export class OutputClockReadiness {
  private anchor: { contextTime: number; offsetMs: number; observedMs: number } | null = null;

  reset(): void { this.anchor = null; }

  ready(ctx: OutputClock & { state: string }, nowPerfMs = performance.now()): boolean {
    if (ctx.state !== "running") { this.reset(); return false; }
    const ts = outputTimestamp(ctx);
    // A supported API returning zero is warming up, not an invitation to use another mapping.
    if (typeof ctx.getOutputTimestamp === "function" && (!ts || nowPerfMs - ts.performanceTime > 1000 || ts.performanceTime > nowPerfMs + 100)) {
      this.reset(); return false;
    }
    const contextTime = ts?.contextTime ?? ctx.currentTime;
    const offsetMs = contextTime * 1000 - (ts?.performanceTime ?? nowPerfMs);
    if (!this.anchor || contextTime < this.anchor.contextTime || Math.abs(offsetMs - this.anchor.offsetMs) > 20) {
      this.anchor = { contextTime, offsetMs, observedMs: nowPerfMs };
      return false;
    }
    return contextTime > this.anchor.contextTime && nowPerfMs - this.anchor.observedMs >= 250;
  }
}

// Adapted from BeatSync perfTimeToAudioTime (MIT). This is the only output-clock
// mapping. Only the fallback uses reported latency; never subtract it from a valid timestamp.
export function perfToAudioTime(ctx: OutputClock, perfMs: number, nowPerfMs = performance.now()): number {
  const ts = outputTimestamp(ctx);
  if (ts) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
  return ctx.currentTime + (perfMs - nowPerfMs) / 1000 - latency(ctx.baseLatency) - latency(ctx.outputLatency);
}

export function serverMsToAudioTime(clock: SynchronizedClock, ctx: OutputClock, serverMs: number, nowPerfMs?: number): number {
  return perfToAudioTime(ctx, clock.toLocalPerformanceMs(serverMs), nowPerfMs);
}
