"use client";
import { useState } from "react";
import { useSnapshot, useAdapter } from "../lib/useSnapshot";
import { audienceSummary } from "../lib/summary";
import { MapPanel } from "../components/MapPanel";
import { CalibrationPanel } from "../components/CalibrationPanel";
import { AssignPanel } from "../components/AssignPanel";
import { PerformPanel } from "../components/PerformPanel";
import { JoinCode } from "../components/JoinCode";
import { clockReady } from "../lib/clock";

type Tab = "session" | "calibration" | "review" | "assign" | "perform";

export default function Page() {
  const { snapshot, error, loading, refresh, login } = useSnapshot(1000);
  const adapter = useAdapter();
  const [tab, setTab] = useState<Tab>("session");
  const [secret, setSecret] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const summary = snapshot ? audienceSummary(snapshot) : null;
  const pending = adapter.pending();
  const pendingCount = pending.filter(p => p.status === "pending").length;
  const disconnected = !loading && !!error;

  return (
    <main>
      <p className="eyebrow">AUDIENCE ORCHESTRA</p>
      <h1>Admin console</h1>
      {disconnected && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!snapshot && <form onSubmit={event => { event.preventDefault(); setActionError(null); void login(secret).catch(cause => setActionError(String(cause))); }}>
        <label>Operator secret <input type="password" autoComplete="current-password" value={secret} onChange={event => setSecret(event.target.value)} /></label>
        <button type="submit">Connect operator</button>
      </form>}
      {actionError && <p role="alert" className="error">{actionError}</p>}
      {snapshot && <div className="operator-bar"><span>{clockReady() ? "Operator clock synchronized" : "Synchronizing operator clock…"}</span>
        <button className="panic" onClick={() => { setActionError(null); void adapter.panic().then(refresh).catch(cause => setActionError(String(cause))); }}>PANIC — MUTE ALL</button></div>}

      <nav className="tabs">
        {(["session", "calibration", "review", "assign", "perform"] as Tab[]).map(t => (
          <button key={t} className={tab === t ? "tab on" : "tab"} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      {loading && !snapshot && <p>Trying the real server…</p>}

      {tab === "session" && (
        snapshot && summary ? (
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
            <p>{snapshot.show.channels.map(channel => `${channel.label}: ${snapshot.assignments.filter(item => item.channelId === channel.channelId).length} assigned`).join(" · ")}</p>
            <JoinCode sessionId={snapshot.sessionId} />
            <p className="muted">Revision {snapshot.revision}. Pending commands: {pendingCount}. {pendingCount > 0 && "Shown as pending until the server confirms."}</p>
          </section>
        ) : <NotDetectedSection label="Session" />
      )}

      <div hidden={tab !== "calibration"}>
        <CalibrationPanel refresh={refresh} snapshot={snapshot} />
      </div>

      {tab === "review" && (
        snapshot ? (
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
            <p className="muted">Evidence: {snapshot.audienceMap.evidence}. Run: {snapshot.audienceMap.runId ?? "none"}.</p>
          </section>
        ) : <NotDetectedSection label="Review" />
      )}

      {tab === "assign" && (
        snapshot ? <AssignPanel snapshot={snapshot} refresh={refresh} /> : <NotDetectedSection label="Assign" />
      )}

      {tab === "perform" && (
        snapshot ? <PerformPanel snapshot={snapshot} refresh={refresh} /> : <NotDetectedSection label="Perform" />
      )}

      {pending.length > 0 && (
        <section>
          <h2>Pending vs confirmed</h2>
          <p className="muted">Accepted commands remain scheduled until the server reports their execution.</p>
          <ul className="pending">
            {pending.slice(-6).map(p => <li key={p.commandId}>{p.commandId.slice(0, 10)} — {p.domain} — {p.status}</li>)}
          </ul>
        </section>
      )}
    </main>
  );
}

function NotDetectedSection({ label }: { label: string }) {
  return (
    <section>
      <h2>{label}</h2>
      <p className="muted">Connect with the operator secret to use {label}. If the server is unavailable, start the local concert services.</p>
    </section>
  );
}
