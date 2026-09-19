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

export { AudioContextHost, isAudioContextPaused } from "./context";
export { perfToAudioTime, serverMsToAudioTime } from "./timing";
export { AssetError, DecodedBudget, DEFAULT_DECODED_BUDGET_BYTES, decodedBytes, loadTrack, preloadTracks, sha256Hex, type LoadedTrack, type PreloadFailure, type TrackData } from "./assets";
export { scheduleClick, type ScheduledClick } from "./schedule";
export { clipStarts, REJOIN_LEAD_MS, showPositionAt, type ClipStart, type TransportData } from "./timeline";
export { channelLevel, PlaybackEngine, RAMP_MS, type ChannelMix, type MixState, type PlaybackEngineOptions } from "./playback";
