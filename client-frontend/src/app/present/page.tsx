"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { participantLink } from "../../lib/participant-link";
import { ConcertoOrb } from "../concerto-orb";

type Counts = { sessionId: string; connected: number; synced: number; soundReady: number; assetsReady: number; mapped: number; stage: string };
export default function PresentPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [offline, setOffline] = useState(false);
  const [qr, setQr] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  useEffect(() => {
    let stopped = false;
    const read = async () => { try { const response = await fetch("/api/presentation", { cache: "no-store" }); if (!response.ok) throw new Error(); const data = await response.json(); if (!stopped) { setCounts(data); setOffline(false); } } catch { if (!stopped) setOffline(true); } };
    void read(); const timer = setInterval(read, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!counts?.sessionId) return;
    let current = true;
    let url: string;
    try { url = participantLink(process.env.NEXT_PUBLIC_PARTICIPANT_URL ?? window.location.origin, counts.sessionId); }
    catch { url = participantLink(window.location.origin, counts.sessionId); }
    setJoinUrl(url);
    void QRCode.toDataURL(url, { width: 1000, margin: 4, errorCorrectionLevel: "M", color: { dark: "#111214", light: "#ffffff" } }).then(value => { if (current) setQr(value); });
    return () => { current = false; };
  }, [counts?.sessionId]);
  return <main className="present-shell">
    <header className="present-header"><div className="audience-brand"><span className="brand-mark" aria-hidden="true">c</span><span>Concerto</span></div><span className="live-pill"><i className={offline || !counts ? "" : "ok"} />{offline ? "Reconnecting" : counts ? "Live" : "Connecting"}</span></header>
    <div className="present-hero"><div className="present-copy"><ConcertoOrb ready={!!counts && !offline} paused={offline} /><h1>Play your<br /><em>part.</em></h1><p className="present-instruction">Volume up. Stay on the page.</p></div>
      <div className="join-panel"><div className="projector-qr">{qr ? <img src={qr} alt="Scan to join Concerto" /> : <div className="qr-loading">Preparing join code…</div>}</div><h2>Scan to join <span aria-hidden="true">↗</span></h2><a className="join-address" href={joinUrl || undefined}>{joinUrl ? new URL(joinUrl).host : "Connecting…"}</a></div></div>
    <div className="present-stats" aria-live="polite">{[["Connected", counts?.connected], ["In sync", counts?.synced], ["Music ready", counts?.assetsReady]].map(([label, value]) => <div key={label}><strong>{offline ? "—" : value ?? "—"}</strong><span>{label}</span></div>)}<p>{offline ? "Reconnecting to the show…" : counts?.stage === "performing" ? "The show is live." : counts?.stage === "calibrating" ? "Phones up. Screens toward the stage." : ""}</p></div>
  </main>;
}
