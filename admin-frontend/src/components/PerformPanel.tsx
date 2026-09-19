"use client";
import { useEffect, useState } from "react";
import { useAdapter } from "../lib/useSnapshot";
import { nowServerMs, showPositionMs } from "../lib/clock";
import type { AdminSnapshotData } from "@orchestra/contracts";

export function PerformPanel({ snapshot, refresh }: { snapshot: AdminSnapshotData; refresh: () => void }) {
  const adapter = useAdapter();
  const [position, setPosition] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { transport, show } = snapshot;
  const endMs = Math.max(1, ...show.clips.map(c => c.timelineStartMs + c.durationMs));
  const widthMs = endMs;

  function futureMs(delaySeconds: number) { return (snapshot.serverMs ?? 0) + delaySeconds * 1000; }

  // Drive the playhead from the shared clock for playing state only.
  useEffect(() => {
    if (transport.status !== "playing") { setPosition(showPositionMs(transport)); return; }
    let raf = 0;
    const tick = () => { setPosition(showPositionMs(transport)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [transport]);

  async function send(action: "play" | "pause" | "stop" | "seek", positionMsArg?: number) {
    setError(null); setStatus(null);
    try {
      const pos = action === "stop" ? 0 : (positionMsArg ?? showPositionMs(transport));
      await adapter.sendTransport({ action, showRevision: show.showRevision, positionMs: pos, effectiveServerMs: futureMs(0) });
      setStatus(`${action} sent — pending.`);
      refresh();
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  }

  async function setChannel(channelId: string, patch: Partial<{ gain: number; mute: boolean; solo: boolean }>) {
    setError(null);
    try {
      const channels = show.channels.map(c => c.channelId === channelId ? { ...c, ...patch } : c);
      await adapter.sendMix({ masterGain: 1, channels, effectiveServerMs: futureMs(0) });
      refresh();
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  }

  async function panic() {
    setError(null);
    try { await adapter.panic(); setStatus("Panic — all pending cleared, transport stopped, channels muted."); refresh(); }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  }

  const playheadPct = Math.min(100, (position / widthMs) * 100);
  const pendingTransport = snapshot.pendingActions.find(a => a.domain === "transport");
  const pendingCountdown = pendingTransport && transport.status !== "playing"
    ? Math.max(0, (pendingTransport.effectiveServerMs - nowServerMs()) / 1000) : null;

  return (
    <section>
      <h2>Perform</h2>
      <p className="muted">Four lanes, one per channel. The playhead is driven by the shared clock, not a UI timer. Scheduled changes show a pending countdown before they take effect. Panic clears everything and mutes.</p>
      {error && <p role="alert" className="error">Error: {error}</p>}
      {status && <p className="status">{status}</p>}
      {pendingCountdown !== null && pendingCountdown > 0 && <p className="notice">Pending change in {pendingCountdown.toFixed(1)}s…</p>}

      <div className="timeline">
        <div className="ruler">
          <div className="playhead" style={{ left: `${playheadPct}%` }} />
        </div>
        {show.channels.map(ch => (
          <div key={ch.channelId} className="lane-row" style={{ borderColor: ch.color }}>
            <div className="lane-label" style={{ background: ch.color }}>{ch.label}</div>
            <div className="lane-track">
              {show.clips.filter(c => c.channelId === ch.channelId).map(clip => (
                <div key={clip.clipId} className="clip" title={`${clip.trackId}`}
                  style={{ left: `${(clip.timelineStartMs / widthMs) * 100}%`, width: `${(clip.durationMs / widthMs) * 100}%`, background: ch.color }}>
                  {clip.trackId}
                </div>
              ))}
            </div>
            <div className="lane-controls">
              <input type="range" min={0} max={1} step={0.01} value={ch.gain} onChange={e => setChannel(ch.channelId, { gain: Number(e.target.value) })} aria-label={`${ch.label} gain`} />
              <button className={ch.mute ? "toggle on" : "toggle"} onClick={() => setChannel(ch.channelId, { mute: !ch.mute })}>M</button>
              <button className={ch.solo ? "toggle on" : "toggle"} onClick={() => setChannel(ch.channelId, { solo: !ch.solo })}>S</button>
            </div>
          </div>
        ))}
      </div>

      <div className="actions">
        <button onClick={() => send("play")} disabled={transport.status === "playing"}>Play</button>
        <button onClick={() => send("pause")} disabled={transport.status === "stopped"}>Pause</button>
        <button onClick={() => send("stop")}>Stop</button>
        <button onClick={() => send("seek", 0)}>Rewind</button>
        <span className="muted">Status: {transport.status}. Position: {(position / 1000).toFixed(1)}s / {(widthMs / 1000).toFixed(1)}s</span>
        <button className="panic" onClick={panic}>PANIC</button>
      </div>
    </section>
  );
}
