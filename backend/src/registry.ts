import { createHash, randomUUID } from "node:crypto";
import type { CheckpointData } from "./checkpoint";

export const MAX_DEVICES = 2048;

export interface DeviceRecord {
  deviceId: number;
  tokenHash: string;
  joinedServerMs: number;
}

export type JoinOutcome =
  | { ok: true; deviceId: number; resumeToken: string; allocated: boolean }
  | { ok: false; code: "CAPACITY_REACHED" | "INVALID_RESUME_TOKEN" };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class DeviceRegistry {
  private readonly devices = new Map<number, DeviceRecord>();
  private readonly deviceIdByTokenHash = new Map<string, number>();
  private nextDeviceId = 0;

  reset(): void { this.devices.clear(); this.deviceIdByTokenHash.clear(); this.nextDeviceId = 0; }

  // IDs are allocated from 0 upward and never recycled, so a stale message from a departed
  // device can never be attributed to whoever joined after it.
  join(resumeToken: string | undefined, joinedServerMs: number): JoinOutcome {
    if (resumeToken !== undefined) {
      const deviceId = this.deviceIdByTokenHash.get(hashToken(resumeToken));
      if (deviceId === undefined) return { ok: false, code: "INVALID_RESUME_TOKEN" };
      return { ok: true, deviceId, resumeToken, allocated: false };
    }
    if (this.nextDeviceId >= MAX_DEVICES) return { ok: false, code: "CAPACITY_REACHED" };

    const deviceId = this.nextDeviceId++;
    const token = `${randomUUID()}${randomUUID()}`;
    const tokenHash = hashToken(token);
    this.devices.set(deviceId, { deviceId, tokenHash, joinedServerMs });
    this.deviceIdByTokenHash.set(tokenHash, deviceId);
    return { ok: true, deviceId, resumeToken: token, allocated: true };
  }

  // Tokens are 288 bits of randomness looked up by hash, so an attacker cannot narrow a guess
  // by timing. The operator secret is human-chosen and is compared in constant time instead.
  authenticate(resumeToken: string): number | null {
    return this.deviceIdByTokenHash.get(hashToken(resumeToken)) ?? null;
  }

  has(deviceId: number): boolean {
    return this.devices.has(deviceId);
  }

  get size(): number {
    return this.devices.size;
  }

  toCheckpoint(
    sessionId: string,
    show: CheckpointData["show"] = null,
    map: CheckpointData["map"] = null,
    committedRunTag: CheckpointData["committedRunTag"] = null,
    assignments: CheckpointData["assignments"] = [],
    nextRunTag = 0,
    manualRoutingDeviceIds: number[] = [],
  ): CheckpointData {
    return {
      version: 3,
      sessionId,
      nextDeviceId: this.nextDeviceId,
      devices: [...this.devices.values()],
      show,
      map,
      committedRunTag,
      assignments, nextRunTag, manualRoutingDeviceIds,
    };
  }

  restore(data: CheckpointData): void {
    this.devices.clear();
    this.deviceIdByTokenHash.clear();
    this.nextDeviceId = data.nextDeviceId;
    for (const device of data.devices) {
      this.devices.set(device.deviceId, device);
      this.deviceIdByTokenHash.set(device.tokenHash, device.deviceId);
    }
  }
}
