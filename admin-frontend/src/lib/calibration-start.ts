import type { AdminSnapshotData } from "@orchestra/contracts";

export function calibrationStartDisabledReason(busy: boolean, barrier: AdminSnapshotData["preparations"][number] | undefined): string | null {
  if (busy) return "Waiting for the current calibration request to finish.";
  if (!barrier) return "Waiting for the server to confirm this calibration preparation.";
  if (!barrier.readyIds.length) {
    const pending = barrier.expectedIds.length - barrier.excluded.length;
    return `No phones have acknowledged this calibration: ${pending} pending, ${barrier.excluded.length} excluded. Keep eligible phones connected and visible while they synchronize.`;
  }
  return null;
}
