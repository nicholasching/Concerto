"use client";
import { useState } from "react";
import { useSnapshot, useAdapter } from "../lib/useSnapshot";
import { audienceSummary } from "../lib/summary";
import { CalibrationPanel } from "../components/CalibrationPanel";
import { AssignPanel } from "../components/AssignPanel";
import { PerformPanel } from "../components/PerformPanel";
import { clockReady } from "../lib/clock";
import { Star } from "../components/Star";

export default function Page() {
  const { snapshot, error, loading, refresh, login } = useSnapshot(1000);
  const adapter = useAdapter();
  const [secret, setSecret] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const summary = snapshot ? audienceSummary(snapshot) : null;
  const pending = adapter.pending();
  const pendingCount = pending.filter(command => ["pending", "accepted", "scheduled"].includes(command.status)).length;
  const musicReady = snapshot?.devices.filter(device => device.connected && snapshot.show.tracks.length > 0 && snapshot.show.tracks.every(track => device.decodedTrackHashes[track.trackId] === track.sha256)).length ?? 0;
  async function reset() {
    setResetting(true); setActionError(null);
    try { await adapter.resetAudience(); setResetOpen(false); await refresh(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setResetting(false); }
  }
  if (!snapshot) return <main className="login-shell"><div className="brand"><Star />Concerto</div>
    <div className="login-panel"><h1>Stage control.</h1>
      <form onSubmit={event => { event.preventDefault(); setActionError(null); void login(secret).catch(cause => setActionError(cause instanceof Error ? cause.message : String(cause))); }}>
        <label>Admin password<input type="password" autoComplete="current-password" autoFocus value={secret} onChange={event => setSecret(event.target.value)} /></label>
        <button className="primary large" type="submit" disabled={!secret}>Sign in</button>
      </form>
      {actionError && <p role="alert" className="error">{actionError}</p>}
      {!loading && error?.includes("not detected") && <p className="error">The control server is unavailable. Start the concert services to connect.</p>}
    </div></main>;

  return <main className="console-shell">
    <header className="console-header"><div><div className="brand"><Star />Concerto</div><h1>Stage control<span className="live-tag">LIVE</span></h1></div>
      <div className="header-links"><a href="/present" target="_blank" rel="noreferrer">Projector view ↗</a><a href="/upload" target="_blank" rel="noreferrer">Camera uploads ↗</a></div></header>
    <div className="command-bar"><nav aria-label="Show stages"><button className="reset-control" onClick={() => setResetOpen(true)}>Reset</button><a href="#calibration"><span>01</span> Calibration</a><a href="#assign"><span>02</span> Assign</a><a href="#performance"><span>03</span> Performance</a></nav>
      <button className="panic" onClick={() => { setActionError(null); void adapter.panic().then(refresh).catch(cause => setActionError(String(cause))); }}>Mute all</button></div>
    {(error || actionError) && <p role="alert" className="error notice-box">{actionError ?? error}</p>}
    <div className="session-overview"><div className="section-caption"><span>AUDIENCE STATUS</span><span className={clockReady() ? "status" : "muted"}>{clockReady() ? "● Control clock in sync" : "○ Synchronizing control clock"}</span></div>
      <div className="metric-grid">{[[summary?.connected, "Connected", "Live phones"], [summary?.clockReady, "In sync", "Ready for timing"], [musicReady, "Music verified", "Assets on device"], [summary?.audioUnlocked, "Sound enabled", "Audio ready"], [summary?.localized, "Mapped", "Positions confirmed"]].map(([count, label, description]) => <div className="metric" key={String(label)}><span>{label}</span><strong>{count ?? 0}</strong><small>{description}</small></div>)}</div>
    </div>
    <div className="stage-panels" key={snapshot.serverEpoch}>
      <div id="calibration"><CalibrationPanel refresh={refresh} snapshot={snapshot} /></div>
      <div id="assign"><AssignPanel snapshot={snapshot} refresh={refresh} /></div>
      <div id="performance"><PerformPanel snapshot={snapshot} refresh={refresh} /></div>
    </div>
    <footer className="console-footer"><span>{snapshot.show.label}</span><span>{snapshot.transport.status} · {pendingCount} pending commands</span><details><summary>Command history</summary><ul className="pending">{pending.slice(-8).map(command => <li key={command.commandId}>{command.domain} · {command.status}{command.error ? ` · ${command.error}` : ""}</li>)}</ul></details></footer>
    {resetOpen && <div className="modal-backdrop"><div className="reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-title"><h2 id="reset-title">Reset all devices?</h2><p>This stops playback and clears every device, position and assignment. The prepared show and audio stay saved.</p><p>Audience phones will need to refresh to join again.</p><div className="actions"><button onClick={() => setResetOpen(false)} disabled={resetting}>Keep this audience</button><button className="panic" onClick={() => void reset()} disabled={resetting}>{resetting ? "Resetting…" : "Disconnect and reset"}</button></div></div></div>}
  </main>;
}
