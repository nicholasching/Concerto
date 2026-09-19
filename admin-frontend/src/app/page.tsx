"use client";
import { useState } from "react";
import { useSnapshot, useAdapter } from "../lib/useSnapshot";
import { audienceSummary } from "../lib/summary";
import { MapPanel } from "../components/MapPanel";
import { CalibrationPanel } from "../components/CalibrationPanel";
import { AssignPanel } from "../components/AssignPanel";
import { PerformPanel } from "../components/PerformPanel";

type Tab = "session" | "calibration" | "review" | "assign" | "perform";

export default function Page() {
  const { snapshot, error, loading, refresh } = useSnapshot(1000);
  const adapter = useAdapter();
  const [tab, setTab] = useState<Tab>("session");
  const mock = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "1";

  const summary = snapshot ? audienceSummary(snapshot) : null;
  const pending = adapter.pending();
  const pendingCount = pending.filter(p => p.status === "pending").length;

  return (
    <main>
      <p className="eyebrow">AUDIENCE ORCHESTRA / TEAM 4</p>
      <h1>Admin console</h1>
      <p className="notice">{mock ? "SYNTHETIC FAKE-INPUT HARNESS" : "FOUNDATION SHELL"}</p>
      {error && <p role="alert" className="error">Server error: {error}. The console never shows fake success — this is a real error from the harness/server.</p>}

      <nav className="tabs">
        {(["session", "calibration", "review", "assign", "perform"] as Tab[]).map(t => (
          <button key={t} className={tab === t ? "tab on" : "tab"} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      {loading && !snapshot && <p>Loading snapshot…</p>}

      {snapshot && summary && tab === "session" && (
        <section>
          <h2>Session</h2>
          <p className="muted">The audience scans the QR code to join. Watch the counts; keep the panic control visible.</p>
          <div className="stats">
            <p><strong>{summary.connected}</strong><br />connected</p>
            <p><strong>{summary.clockReady}</strong><br />clock synced</p>
            <p><strong>{summary.audioUnlocked}</strong><br />audio unlocked</p>
            <p><strong>{summary.localized}</strong><br />localized</p>
            <p><strong>{summary.unresolved}</strong><br />unresolved</p>
          </div>
          <div className="qr-box">
            <pre>{`  █▀▀▀▀█  █▀▀▀▀█
  █ ███ █  █ ███ █
  █ ▀▀▀ █  █ ▀▀▀ █
  ▀▀▀▀▀▀▀  ▀▀▀▀▀▀▀`}</pre>
            <p className="muted">QR placeholder — phones scan this to join (Team 2 client).</p>
          </div>
          <p className="muted">Revision {snapshot.revision}. Pending commands: {pendingCount}. {pendingCount > 0 && "Shown as pending until the server confirms."}</p>
          <button className="panic" onClick={() => { void adapter.panic(); refresh(); }}>PANIC</button>
        </section>
      )}

      {snapshot && tab === "calibration" && (
        <CalibrationPanel refresh={refresh} mapRevision={snapshot.audienceMap.mapRevision} />
      )}

      {snapshot && tab === "review" && (
        <section>
          <h2>Review</h2>
          <p className="muted">The audience map after calibration. One dot per phone, colored by status or assignment. Switch to Assign to draw selections.</p>
          <MapPanel map={snapshot.audienceMap} assignments={snapshot.assignments} channels={snapshot.show.channels} drawable={false} />
          <div className="legend">
            <span><i style={{ background: "#71d0b0" }} /> localized</span>
            <span><i style={{ background: "#f2c76d" }} /> coarse</span>
            <span><i style={{ background: "#e08a8a" }} /> ambiguous</span>
            <span><i style={{ background: "#5a6b86" }} /> unseen</span>
          </div>
          <p className="muted">Evidence: {snapshot.audienceMap.evidence} (synthetic = from the harness, not real cameras). Run: {snapshot.audienceMap.runId ?? "none"}.</p>
        </section>
      )}

      {snapshot && tab === "assign" && (
        <AssignPanel snapshot={snapshot} refresh={refresh} />
      )}

      {snapshot && tab === "perform" && (
        <PerformPanel snapshot={snapshot} refresh={refresh} />
      )}

      {pending.length > 0 && (
        <section>
          <h2>Pending vs confirmed</h2>
          <p className="muted">Every command starts pending and becomes confirmed once the server reports a newer revision. Nothing is shown as success early.</p>
          <ul className="pending">
            {pending.slice(-6).map(p => <li key={p.commandId}>{p.commandId.slice(0, 10)} — {p.domain} — {p.status}</li>)}
          </ul>
        </section>
      )}
    </main>
  );
}
