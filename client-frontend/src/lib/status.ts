import type { ParticipantSnapshotData } from "@orchestra/contracts";

export function participantStatus(snapshot: ParticipantSnapshotData): string {
  const { readiness, assignment, show } = snapshot;
  if (!readiness.connected) return "Disconnected";
  if (!readiness.clockReady) return "Clock not ready";
  if (!readiness.audioUnlocked) return "Audio not enabled";
  if (assignment.channelId === null) return "No channel assigned";
  const tracks = show.clips.filter(clip => clip.channelId === assignment.channelId).map(clip => show.tracks.find(track => track.trackId === clip.trackId));
  if (tracks.some(track => !track || readiness.decodedTrackHashes[track.trackId] !== track.sha256)) return "Assets not ready";
  return "Prepared; playback implementation pending";
}
