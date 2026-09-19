/**
 * Samples how late a fixed-interval timer actually fires. Delay here means the control process was
 * busy and could not answer sockets, so this is the number that says whether the server survived a
 * load run. It can only be measured inside the process; a client's round trip cannot tell this
 * apart from network delay.
 */
export class LoopLagSampler {
  private readonly samples: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly intervalMs = 100,
    private readonly maxSamples = 10_000,
  ) {}

  start(now: () => number = () => performance.now()): void {
    if (this.timer) return;
    let expected = now() + this.intervalMs;
    this.timer = setInterval(() => {
      const actual = now();
      this.record(Math.max(0, actual - expected));
      expected = actual + this.intervalMs;
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  record(lagMs: number): void {
    this.samples.push(lagMs);
    // A long run must not grow without bound; the oldest samples are the least interesting.
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  summary(): { count: number; p50: number; p95: number; p99: number; max: number } {
    if (this.samples.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
    return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1] };
  }

  reset(): void {
    this.samples.length = 0;
  }
}
