import type { AdminSnapshotData } from "@orchestra/contracts";

export function audienceSummary(snapshot: AdminSnapshotData) {
  return {
    connected: snapshot.devices.filter(device => device.connected).length,
    clockReady: snapshot.devices.filter(device => device.connected && device.clockReady).length,
    audioUnlocked: snapshot.devices.filter(device => device.connected && device.audioUnlocked).length,
    localized: snapshot.audienceMap.locations.filter(location => location.status === "localized").length,
    unresolved: snapshot.audienceMap.locations.filter(location => location.status !== "localized").length,
  };
}
