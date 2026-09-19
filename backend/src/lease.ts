export const LEASE_RENEW_INTERVAL_MS = 1000;
export const LEASE_DURATION_MS = 5000;

/**
 * Permission to make sound, granted in short slices. A phone compares the expiry against its own
 * synchronized clock and mutes itself once it passes, so a server that dies, or a network that
 * drops, silences the hall without anyone having to reach it.
 *
 * Four consecutive renewals must be lost before a phone goes quiet, which keeps an ordinary hiccup
 * from muting a piece mid-performance.
 */
export class AudioLease {
  private suspended = false;
  private lastExpiresServerMs = 0;

  constructor(
    private readonly durationMs = LEASE_DURATION_MS,
    private readonly intervalMs = LEASE_RENEW_INTERVAL_MS,
  ) {}

  get expiresServerMs(): number {
    return this.lastExpiresServerMs;
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  get renewIntervalMs(): number {
    return this.intervalMs;
  }

  // Null while suspended: after a panic the server deliberately stops granting permission, so a
  // phone that never received the panic broadcast still falls silent when its lease runs out.
  renew(nowServerMs: number): number | null {
    if (this.suspended) return null;
    this.lastExpiresServerMs = nowServerMs + this.durationMs;
    return this.lastExpiresServerMs;
  }

  suspend(nowServerMs: number): void {
    this.suspended = true;
    this.lastExpiresServerMs = nowServerMs;
  }

  resume(): void {
    this.suspended = false;
  }
}
