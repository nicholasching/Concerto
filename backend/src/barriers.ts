export interface BarrierCounts {
  expected: number;
  ready: number;
  pending: number;
  excluded: number;
}

// A barrier answers one question: which devices have confirmed *this* preparation. It is created
// per preparation and discarded when superseded, so a late acknowledgement for an older
// preparation finds nothing to satisfy and cannot count toward the current one.
export class Barrier {
  private readonly expectedIds: Set<number>;
  private readonly readyIds = new Set<number>();
  private readonly excludedIds = new Map<number, string>();

  constructor(
    readonly preparationId: string,
    readonly showRevision: number,
    readonly transportRevision: number,
    expected: Iterable<number>,
  ) {
    this.expectedIds = new Set(expected);
  }

  acknowledge(input: {
    deviceId: number;
    preparationId: string;
    ready: boolean;
    reason: string | null;
    showRevision: number;
    transportRevision: number;
  }): boolean {
    if (input.preparationId !== this.preparationId) return false;
    if (input.showRevision !== this.showRevision || input.transportRevision !== this.transportRevision) return false;
    if (!this.expectedIds.has(input.deviceId)) return false;

    if (input.ready) {
      this.excludedIds.delete(input.deviceId);
      this.readyIds.add(input.deviceId);
    } else {
      this.readyIds.delete(input.deviceId);
      this.excludedIds.set(input.deviceId, input.reason ?? "reported not ready");
    }
    return true;
  }

  // Calibration acknowledgements name a run rather than show and transport revisions, so the
  // preparation id alone identifies what is being confirmed. The caller checks the run.
  acknowledgePreparation(input: { deviceId: number; preparationId: string; ready: boolean; reason: string | null }): boolean {
    return this.acknowledge({
      ...input, showRevision: this.showRevision, transportRevision: this.transportRevision,
    });
  }

  // A device that disconnects cannot satisfy the barrier, and waiting for it would hold the show.
  exclude(deviceId: number, reason: string): void {
    if (!this.expectedIds.has(deviceId)) return;
    this.readyIds.delete(deviceId);
    this.excludedIds.set(deviceId, reason);
  }

  readyDevices(): number[] {
    return [...this.readyIds].sort((a, b) => a - b);
  }

  expectedDevices(): number[] { return [...this.expectedIds].sort((a, b) => a - b); }

  excludedDevices(): { deviceId: number; reason: string }[] {
    return [...this.excludedIds].map(([deviceId, reason]) => ({ deviceId, reason })).sort((a, b) => a.deviceId - b.deviceId);
  }

  counts(): BarrierCounts {
    return {
      expected: this.expectedIds.size,
      ready: this.readyIds.size,
      excluded: this.excludedIds.size,
      pending: this.expectedIds.size - this.readyIds.size - this.excludedIds.size,
    };
  }
}
