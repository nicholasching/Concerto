// Console clock helper. The shared clock lives in @orchestra/sync (Team 1); the estimator is not
// implemented yet, so this module reads the server's own serverMs field from each snapshot to
// establish a single offset. This is not a second estimator — it uses the time the server reports,
// not a probed estimate. When Team 1's clock is ready, swap toLocalServerMs here for
// SynchronizedClock.toLocalPerformanceMs and nothing else changes.

let offsetMs = 0; // serverMs = localPerfMs + offsetMs
let lastSyncLocalMs = 0;

const localPerfMs = () => performance.timeOrigin + performance.now();

export function syncFromServerMs(serverMs: number) {
  offsetMs = serverMs - localPerfMs();
  lastSyncLocalMs = localPerfMs();
}

// Current time in the server's ms domain.
export function nowServerMs(): number {
  return localPerfMs() + offsetMs;
}

export function lastSyncAgeMs(): number {
  return localPerfMs() - lastSyncLocalMs;
}

// Showhead position for a transport state, in ms from the show origin.
export function showPositionMs(transport: { status: "stopped" | "paused" | "playing"; positionMs: number; startServerMs: number | null }): number {
  if (transport.status === "playing" && transport.startServerMs !== null) {
    return transport.positionMs + Math.max(0, nowServerMs() - transport.startServerMs);
  }
  return transport.positionMs;
}
