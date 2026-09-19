import type { Barrier } from "./barriers";

export type PreparationDomain = "transport" | "assets" | "assignment" | "calibration";

// One active preparation per domain. Starting a new one discards the previous barrier, which is
// what makes an acknowledgement for a superseded preparation unable to satisfy the current one.
export class Preparations {
  private readonly active = new Map<PreparationDomain, Barrier>();

  start(domain: PreparationDomain, barrier: Barrier): void {
    this.active.set(domain, barrier);
  }

  current(domain: PreparationDomain): Barrier | undefined {
    return this.active.get(domain);
  }

  clear(domain: PreparationDomain): void {
    this.active.delete(domain);
  }

  // A device that drops is excluded everywhere it was expected, so no barrier waits on it.
  excludeEverywhere(deviceId: number, reason: string): void {
    for (const barrier of this.active.values()) barrier.exclude(deviceId, reason);
  }
}
