import type { ParticipantSnapshotData, ShowData } from "@orchestra/contracts";

export type TransportData = ParticipantSnapshotData["transport"];
export const REJOIN_LEAD_MS = 1000;

/** Show playhead at a server time. A playing transport that hasn't reached its start holds positionMs. */
export function showPositionAt(transport: TransportData, serverMs: number): number {
  if (transport.status === "stopped") return 0;
  if (transport.status === "paused") return transport.positionMs;
  return transport.positionMs + Math.max(0, serverMs - transport.startServerMs);
}

export interface ClipStart {
  clipId: string;
  trackId: string;
  startServerMs: number;
  offsetMs: number;
  durationMs: number;
  gain: number;
}

/** Every clip on a channel that sounds from `fromServerMs` on, with its server start time and source offset. */
export function clipStarts(show: ShowData, channelId: string | null, transport: TransportData, fromServerMs: number): ClipStart[] {
  if (transport.status !== "playing" || channelId === null) return [];
  const from = Math.max(fromServerMs, transport.startServerMs);
  const position = showPositionAt(transport, from);
  return show.clips
    .filter(clip => clip.channelId === channelId && clip.timelineStartMs + clip.durationMs > position)
    .sort((a, b) => a.timelineStartMs - b.timelineStartMs)
    .map(clip => {
      const into = Math.max(0, position - clip.timelineStartMs);
      return {
        clipId: clip.clipId,
        trackId: clip.trackId,
        startServerMs: from + Math.max(0, clip.timelineStartMs - position),
        offsetMs: clip.sourceOffsetMs + into,
        durationMs: clip.durationMs - into,
        gain: clip.gain,
      };
    });
}
