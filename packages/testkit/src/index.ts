import { AdminSnapshot, ParticipantSnapshot, type AdminSnapshotData, type ParticipantSnapshotData } from "@orchestra/contracts";
import fixture from "../../../fixtures/admin-snapshot.json";
import type { SynchronizedClock } from "@orchestra/sync";

export function createDemoSnapshot(count = 30): AdminSnapshotData {
  if (!Number.isInteger(count) || count < 1 || count > 2048) throw new RangeError("fixture count must be 1..2048");
  const snapshot = AdminSnapshot.parse(structuredClone(fixture));
  const rows = Math.ceil(count / 30);
  snapshot.devices = Array.from({ length: count }, (_, deviceId) => ({ ...snapshot.devices[0], deviceId }));
  snapshot.assignments = Array.from({ length: count }, (_, deviceId) => ({ ...snapshot.assignments[0], deviceId }));
  snapshot.audienceMap.locations = Array.from({ length: count }, (_, deviceId) => {
    const location = snapshot.audienceMap.locations[deviceId % 30];
    return location.status === "localized"
      ? { ...location, deviceId, x: (deviceId % 3 + 0.08 + (Math.floor(deviceId / 3) % 10) * 0.084) / 3, y: (Math.floor(deviceId / 30) + 0.5) / rows }
      : { ...location, deviceId };
  });
  return AdminSnapshot.parse(snapshot);
}

export function participantSnapshot(snapshot: AdminSnapshotData, deviceId = 0): ParticipantSnapshotData {
  const readiness = snapshot.devices.find(device => device.deviceId === deviceId);
  const assignment = snapshot.assignments.find(item => item.deviceId === deviceId);
  const location = snapshot.audienceMap.locations.find(item => item.deviceId === deviceId);
  const { audienceMap: _map, devices: _devices, assignments: _assignments, ...base } = snapshot;
  return ParticipantSnapshot.parse({ ...base, role: "participant", deviceId, readiness, assignment, location });
}

export class FakeClock implements SynchronizedClock {
  constructor(public serverMs = 100000, public offsetMs = 0) {}
  nowServerMs() { return this.serverMs; }
  toLocalPerformanceMs(serverMs: number) { return serverMs - this.offsetMs; }
  quality() { return { ready: true, uncertaintyMs: 0, sampleAgeMs: 0 }; }
  advance(ms: number) { this.serverMs += ms; }
}
