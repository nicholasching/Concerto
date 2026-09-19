"use client";
import { useEffect, useState } from "react";
import type { AdminSnapshotData, ShowData } from "@orchestra/contracts";
import { useAdapter } from "../lib/useSnapshot";

const names = ["Percussion", "Bass", "Harmony", "Melody"];
const colors = ["#f59e0b", "#34d399", "#a78bfa", "#38bdf8"];
export function ShowEditor({ snapshot, refresh }: { snapshot: AdminSnapshotData; refresh: () => void }) {
  const adapter = useAdapter();
  const [draft, setDraft] = useState<ShowData>(structuredClone(snapshot.show));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDraft(structuredClone(snapshot.show)); setDirty(false); }, [snapshot.show.showRevision]);
  const editable = snapshot.transport.status === "stopped" && snapshot.pendingActions.length === 0;
  function edit(value: ShowData) { setDraft(value); setDirty(true); }
  async function upload(file: File | undefined, channelId: string) {
    if (!file) return;
    setBusy(true); setError(null);
    const context = new AudioContext();
    try {
      if (file.size > 128 * 1024 * 1024) throw new Error("Choose a smaller prepared stem (under 128 MB encoded).");
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      if (buffer.numberOfChannels > 2) throw new Error("Use a mono or stereo stem.");
      const track = await adapter.uploadAudio(file, { durationMs: buffer.duration * 1000, sampleRateHz: buffer.sampleRate, channels: buffer.numberOfChannels });
      const start = Math.max(0, ...draft.clips.filter(clip => clip.channelId === channelId).map(clip => clip.timelineStartMs + clip.durationMs));
      edit({ ...draft, tracks: [...draft.tracks, track], clips: [...draft.clips, { clipId: crypto.randomUUID(), channelId, trackId: track.trackId,
        timelineStartMs: start, sourceOffsetMs: 0, durationMs: track.durationMs, gain: 1 }] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { await context.close(); setBusy(false); }
  }
  const decodedMb = draft.tracks.reduce((sum, track) => sum + track.durationMs / 1000 * track.sampleRateHz * track.channels * 4, 0) / 1024 / 1024;
  return <details open={snapshot.show.clips.length === 0}><summary>Prepare show and stems</summary>
    <p>Align stems to the same musical origin. Add audio per channel, then save while stopped. Phones preload the saved show.</p>
    {!editable && <p>Stop transport and wait for pending changes before editing.</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <fieldset disabled={!editable || busy}>
      <label>Show name <input value={draft.label} onChange={e => edit({ ...draft, label: e.target.value })} /></label>
      {draft.clips.length === 0 && <button onClick={() => edit({ showId: crypto.randomUUID(), showRevision: snapshot.show.showRevision, label: "Audience Orchestra", tracks: [], clips: [],
        channels: names.map((label, index) => ({ channelId: `channel-${index}`, label, color: colors[index], gain: 0.5, mute: false, solo: false })) })}>Set up four channels</button>}
      {draft.channels.map(channel => <div key={channel.channelId}><h3 style={{ color: channel.color }}>{channel.label}</h3>
        <label>Add prepared audio <input type="file" accept="audio/*" aria-label={`Upload ${channel.label} audio`} onChange={e => void upload(e.target.files?.[0], channel.channelId)} /></label>
        {draft.clips.filter(clip => clip.channelId === channel.channelId).map(clip => <div key={clip.clipId} className="clip-editor">
          <strong>{draft.tracks.find(track => track.trackId === clip.trackId)?.label}</strong>
          {(["timelineStartMs", "sourceOffsetMs", "durationMs"] as const).map(field => <label key={field}>{field === "timelineStartMs" ? "Timeline start (s)" : field === "sourceOffsetMs" ? "Source offset (s)" : "Duration (s)"}
            <input type="number" min={field === "durationMs" ? 0.01 : 0} step={0.01} value={clip[field] / 1000} onChange={e => edit({ ...draft, clips: draft.clips.map(item => item.clipId === clip.clipId ? { ...item, [field]: Number(e.target.value) * 1000 } : item) })} /></label>)}
          <label>Clip gain <input type="number" min={0} max={1} step={0.05} value={clip.gain} onChange={e => edit({ ...draft, clips: draft.clips.map(item => item.clipId === clip.clipId ? { ...item, gain: Number(e.target.value) } : item) })} /></label>
          <button onClick={() => { const clips = draft.clips.filter(item => item.clipId !== clip.clipId); edit({ ...draft, clips, tracks: draft.tracks.filter(track => clips.some(item => item.trackId === track.trackId)) }); }}>Remove clip</button>
        </div>)}
      </div>)}
      <p>Decoded audio per phone: approximately {decodedMb.toFixed(1)} MiB / 64 MiB budget.</p>
      <h3>Cue markers</h3>
      {(draft.cueMarkers ?? []).map(cue => <div key={cue.cueId}>
        <label>Cue label <input value={cue.label} onChange={e => edit({ ...draft, cueMarkers: draft.cueMarkers?.map(item => item.cueId === cue.cueId ? { ...item, label: e.target.value } : item) })} /></label>
        <label>Position (seconds) <input type="number" min={0} step={0.1} value={cue.positionMs / 1000} onChange={e => edit({ ...draft, cueMarkers: draft.cueMarkers?.map(item => item.cueId === cue.cueId ? { ...item, positionMs: Number(e.target.value) * 1000 } : item) })} /></label>
        <button onClick={() => edit({ ...draft, cueMarkers: draft.cueMarkers?.filter(item => item.cueId !== cue.cueId) })}>Remove cue</button>
      </div>)}
      <button onClick={() => edit({ ...draft, cueMarkers: [...(draft.cueMarkers ?? []), { cueId: crypto.randomUUID(), label: "New cue", positionMs: 0 }] })}>Add cue marker</button>
      <button disabled={!dirty || decodedMb > 64} onClick={() => { setBusy(true); setError(null); void adapter.saveShow(draft).then(() => { setDirty(false); refresh(); }, cause => setError(String(cause))).finally(() => setBusy(false)); }}>Save prepared show</button>
    </fieldset>
  </details>;
}
