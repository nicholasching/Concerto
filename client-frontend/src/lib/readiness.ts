import { ClientMessage, type ClientMessageData, type ParticipantSnapshotData } from "@orchestra/contracts";
import type { ClockQuality } from "@orchestra/sync";
import type { Timers } from "./connection";

export type DeviceReadinessData = ParticipantSnapshotData["readiness"];

export interface LocalReadiness {
  connected: boolean;
  foreground: boolean;
  clock: ClockQuality | null;
  audioState: string | null;
  verifiedHashes: Record<string, string>;
}

// Each field is its own fact. A socket connection alone never means the phone can play sound.
export function buildReadiness(deviceId: number, local: LocalReadiness): DeviceReadinessData {
  return {
    deviceId,
    connected: local.connected,
    foreground: local.foreground,
    clockReady: local.clock?.ready ?? false,
    clockUncertaintyMs: local.clock?.uncertaintyMs ?? null,
    clockSampleAgeMs: local.clock?.sampleAgeMs ?? null,
    audioUnlocked: local.audioState === "running",
    decodedTrackHashes: { ...local.verifiedHashes },
  };
}

export function statusMessage(snapshot: Pick<ParticipantSnapshotData, "sessionId" | "serverEpoch">, readiness: DeviceReadinessData): ClientMessageData {
  return ClientMessage.parse({
    protocolVersion: 1, sessionId: snapshot.sessionId, serverEpoch: snapshot.serverEpoch,
    messageId: crypto.randomUUID(), type: "device.status", payload: readiness,
  });
}

/** Sends a readiness change at most once per interval; bursts collapse to the latest value. */
export class StatusReporter {
  private lastSent: string | null = null;
  private lastSentAt = -Infinity;
  private latest: DeviceReadinessData | null = null;
  private timer: unknown = null;

  constructor(
    private readonly send: (readiness: DeviceReadinessData) => boolean,
    private readonly timers: Timers,
    private readonly now: () => number = () => performance.now(),
    private readonly minIntervalMs = 500,
  ) {}

  update(readiness: DeviceReadinessData): void {
    this.latest = readiness;
    if (this.timer !== null) return;
    const wait = this.lastSentAt + this.minIntervalMs - this.now();
    if (wait <= 0) this.flush();
    else this.timer = this.timers.setTimeout(() => { this.timer = null; this.flush(); }, wait);
  }

  /** Forget what was sent, e.g. after a reconnect, so the server gets a fresh report. */
  reset(): void {
    this.lastSent = null;
  }

  dispose(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private flush(): void {
    const readiness = this.latest;
    if (!readiness) return;
    const key = JSON.stringify(readiness);
    if (key === this.lastSent) return;
    if (!this.send(readiness)) return;
    this.lastSent = key;
    this.lastSentAt = this.now();
  }
}
