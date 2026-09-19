// A whole auditorium shares one NAT address, so a per-address limit would throttle the venue
// as if it were one abusive client. This bucket is global and sized above a full join wave;
// slice 5's load run is what should set the real numbers.
export const JOIN_LIMIT = { capacity: 300, refillPerSecond: 200 };

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
