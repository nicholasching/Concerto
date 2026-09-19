// A whole auditorium shares one NAT address, so a per-address limit would throttle the venue as if
// it were one abusive client. This bucket is global.
//
// Sized from a measured run rather than a guess: at 300 burst / 200 per second, 1,500 simulated
// phones arriving together were shed 5,616 times and the join wave took 8.5 seconds of backoff,
// while the server itself stayed idle. A full house is the designed case, not abuse, so the burst
// is the session capacity; the refill still caps sustained joins well below what the server showed
// it can absorb.
export const JOIN_LIMIT = { capacity: 2048, refillPerSecond: 200 };

export class RateLimiter {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = now();
  }

  take(): boolean {
    const nowMs = this.now();
    const refilled = ((nowMs - this.lastRefillMs) / 1000) * this.refillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + refilled);
    this.lastRefillMs = nowMs;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
