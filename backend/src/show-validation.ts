import { DECODED_AUDIO_BUDGET_BYTES, type ShowData } from "@orchestra/contracts";

export function validateShow(show: ShowData): string | null {
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique((show.cueMarkers ?? []).map(item => item.cueId))) return "Cue marker IDs must be unique.";
  if (show.tracks.reduce((bytes, track) => bytes + track.durationMs / 1000 * track.sampleRateHz * track.channels * 4, 0) > DECODED_AUDIO_BUDGET_BYTES) return `Prepared audio exceeds the ${DECODED_AUDIO_BUDGET_BYTES / 1024 / 1024} MiB decoded budget per phone.`;
  if (!unique(show.tracks.map(item => item.trackId)) || !unique(show.channels.map(item => item.channelId)) || !unique(show.clips.map(item => item.clipId))) return "Track, channel and clip IDs must be unique.";
  for (const clip of show.clips) {
    const track = show.tracks.find(item => item.trackId === clip.trackId);
    if (!track || !show.channels.some(item => item.channelId === clip.channelId)) return "A clip references an unknown track or channel.";
    if (clip.sourceOffsetMs + clip.durationMs > track.durationMs + 0.01) return "A clip extends beyond its source audio.";
  }
  for (const channel of show.channels) {
    const clips = show.clips.filter(item => item.channelId === channel.channelId).sort((a, b) => a.timelineStartMs - b.timelineStartMs);
    for (let index = 1; index < clips.length; index++) if (clips[index].timelineStartMs < clips[index - 1].timelineStartMs + clips[index - 1].durationMs) return "Clips on one channel must not overlap.";
  }
  return null;
}
