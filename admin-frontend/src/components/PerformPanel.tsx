"use client";
import { useEffect, useState } from "react";
import { useAdapter } from "../lib/useSnapshot";
import { clockReady, futureServerMs, nowServerMs, showPositionMs } from "../lib/clock";
import { ShowEditor } from "./ShowEditor";
import { Waveform } from "./Waveform";
import type { AdminSnapshotData } from "@orchestra/contracts";

export function PerformPanel({ snapshot, refresh }: { snapshot: AdminSnapshotData; refresh: () => void }) {
  const adapter = useAdapter();
  const [position, setPosition] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cuePosition, setCuePosition] = useState<number | null>(null);

  const { transport, show } = snapshot;
  const endMs = Math.max(1, ...show.clips.map(c => c.timelineStartMs + c.durationMs));
  const widthMs = endMs;

  const preparation = snapshot.preparations.find(item => item.domain === "transport");
  const pendingMix = snapshot.pendingActions.find(item => item.domain === "mix");
  const mixChannels = pendingMix?.channels ?? show.channels;
  const masterGain = pendingMix?.masterGain ?? snapshot.mix.masterGain;
  function futureMs(delaySeconds: number) { return futureServerMs(delaySeconds); }

  // Drive the playhead from the shared clock for playing state only.
  useEffect(() => {
    if (transport.status !== "playing") { setPosition(showPositionMs(transport)); return; }
    let raf = 0;
    const tick = () => { setPosition(showPositionMs(transport)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [transport]);

  async function send(action: "prepare" | "play" | "pause" | "stop" | "seek", positionMsArg?: number) {
    setError(null); setStatus(null);
    try {
      const pos = action === "stop" ? 0 : (positionMsArg ?? (action === "play" ? cuePosition : null) ?? showPositionMs(transport));
      await adapter.sendTransport({ action, showRevision: show.showRevision, positionMs: pos, effectiveServerMs: futureMs(2) });
      setStatus(`${action} sent — pending.`);
      refresh();
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  }

  async function setChannel(channelId: string, patch: Partial<{ gain: number; mute: boolean; solo: boolean }>) {
    setError(null);
    try {
      const channels = mixChannels.map(c => c.channelId === channelId ? { ...c, ...patch } : c);
      await adapter.sendMix({ masterGain, channels, effectiveServerMs: futureMs(2) });
      refresh();
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  }

  async function setMaster(value: number) {
    setError(null);
    try { await adapter.sendMix({ masterGain: value, channels: mixChannels, effectiveServerMs: futureMs(2) }); refresh(); }
    catch (cause) { setError(String(cause)); }
  }

  const playheadPct = Math.min(100, (position / widthMs) * 100);
  const pendingTransport = snapshot.pendingActions.find(a => a.domain === "transport");
  const pendingCountdown = pendingTransport && transport.status !== "playing"
    ? Math.max(0, (pendingTransport.effectiveServerMs - nowServerMs()) / 1000) : null;

  return (
    <section>
      <div className="stage-heading"><span className="stage-number">03</span><h2>Performance</h2><span className="stage-badge">{transport.status}</span></div>
      <p className="muted">Prepare a cue, check readiness, then start.</p>
      {error && <p role="alert" className="error">Error: {error}</p>}
      {status && <p className="status">{status}</p>}
      {preparation && <p>Prepared cue: {preparation.readyIds.length}/{preparation.expectedIds.length} acknowledged. {preparation.excluded.length} excluded; {preparation.expectedIds.length - preparation.readyIds.length - preparation.excluded.length} awaiting response.</p>}
      {preparation?.excluded.map(item => <p key={item.deviceId}>Device {item.deviceId}: {item.reason}</p>)}
      {pendingCountdown !== null && pendingCountdown > 0 && <p className="notice">Pending change in {pendingCountdown.toFixed(1)}s…</p>}

      <div className="actions transport-actions">
        <button onClick={() => send("prepare")} disabled={!clockReady() || !show.clips.length}>Prepare cue</button>
        <button className="primary large" onClick={() => send("play")} disabled={!clockReady() || !preparation?.readyIds.length || transport.status === "playing"}>▶ Start show</button>
        <button onClick={() => send("pause")} disabled={transport.status === "stopped"}>Ⅱ Pause</button>
        <button onClick={() => send("stop")}>■ Stop</button>
        <span className="muted" aria-label="Playback position">{(position / 1000).toFixed(1)}s / {(widthMs / 1000).toFixed(1)}s</span>
      </div>

      <div className="timeline">
        <div className="ruler-row"><span /><div className="ruler">
          {Array.from({ length: 5 }, (_, index) => <span key={index} style={{ position: "absolute", left: `${index * 25}%`, transform: index === 4 ? "translateX(-100%)" : index ? "translateX(-50%)" : undefined }}>{(widthMs * index / 4000).toFixed(1)}s</span>)}
          <div className="playhead" style={{ left: `${playheadPct}%` }} />
        </div><span /></div>
        {mixChannels.map(ch => (
          <div key={ch.channelId} className="lane-row" style={{ borderColor: ch.color }}>
            <div className="lane-label" style={{ background: ch.color }}>{ch.label}</div>
            <div className="lane-track">
              {show.clips.filter(c => c.channelId === ch.channelId).map(clip => (
                <div key={clip.clipId} className="clip" title={`${clip.trackId}`}
                  style={{ left: `${(clip.timelineStartMs / widthMs) * 100}%`, width: `${(clip.durationMs / widthMs) * 100}%`, background: ch.color }}>
                  {show.tracks.find(track => track.trackId === clip.trackId)?.label ?? clip.trackId}
                  {show.tracks.filter(track => track.trackId === clip.trackId).map(track => <Waveform key={track.trackId} track={track} offsetMs={clip.sourceOffsetMs} durationMs={clip.durationMs} />)}
                </div>
              ))}
              <div className="playhead" style={{ left: `${playheadPct}%` }} />
            </div>
            <div className="lane-controls">
              <input type="range" min={0} max={1} step={0.01} defaultValue={ch.gain} key={`${ch.channelId}-${ch.gain}`} onPointerUp={e => void setChannel(ch.channelId, { gain: Number(e.currentTarget.value) })} onKeyUp={e => void setChannel(ch.channelId, { gain: Number(e.currentTarget.value) })} aria-label={`${ch.label} gain`} />
              <button className={ch.mute ? "toggle on" : "toggle"} onClick={() => setChannel(ch.channelId, { mute: !ch.mute })}>Mute</button>
              <button className={ch.solo ? "toggle on" : "toggle"} onClick={() => setChannel(ch.channelId, { solo: !ch.solo })}>Solo</button>
            </div>
          </div>
        ))}
      </div>

      <div className="actions">{(show.cueMarkers ?? []).map(cue => <button key={cue.cueId} onClick={() => { setCuePosition(cue.positionMs); setStatus(`Next play starts at ${cue.label}, ${(cue.positionMs / 1000).toFixed(1)}s. Prepare the cue, then play.`); }}>{cue.label} · {(cue.positionMs / 1000).toFixed(1)}s</button>)}</div>

      <label>Seek to seconds <input type="number" min={0} max={widthMs / 1000} defaultValue={0} onKeyDown={e => { if (e.key === "Enter") void send("seek", Number(e.currentTarget.value) * 1000); }} /></label>
      <label>Master gain <input type="range" min={0} max={1} step={0.01} key={masterGain} defaultValue={masterGain} onPointerUp={e => void setMaster(Number(e.currentTarget.value))} onKeyUp={e => void setMaster(Number(e.currentTarget.value))} /></label>
      <ShowEditor snapshot={snapshot} refresh={refresh} />
    </section>
  );
}
