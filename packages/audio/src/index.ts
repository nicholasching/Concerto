import type { SnapshotData } from "@orchestra/contracts";
import type { SynchronizedClock } from "@orchestra/sync";

// Team 2 implements this boundary. No placeholder pretends to emit audio.
export interface AudioEngine {
  unlock(): Promise<void>;
  applySnapshot(snapshot: Extract<SnapshotData, { role: "participant" }>): Promise<void>;
  mute(): void;
  dispose(): void;
}
export interface AudioEngineOptions { clock: SynchronizedClock }
