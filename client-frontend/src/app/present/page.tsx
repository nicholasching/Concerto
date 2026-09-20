"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { participantLink } from "../../lib/participant-link";

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
    void QRCode.toDataURL(url, { width: 1000, margin: 3, errorCorrectionLevel: "M", color: { dark: "#09130e", light: "#ffffff" } }).then(value => { if (current) setQr(value); });
    return () => { current = false; };
  }, [counts?.sessionId]);
  return <main className="present-shell">
    <header className="present-header"><div className="audience-brand"><span className="brand-mark">◒</span><span>AUDIENCE ORCHESTRA</span></div><span className="live-pill"><i />{offline ? "RECONNECTING" : "LIVE FROM THE AUDIENCE"}</span></header>
    <div className="present-hero"><div><p className="eyebrow">YOUR PHONE IS AN INSTRUMENT</p><h1>One crowd.<br /><em>One orchestra.</em></h1><p className="present-instruction">Scan to join. Turn your volume up.<br />Keep your screen open.</p><div className="join-address">{joinUrl ? new URL(joinUrl).host : "Connecting to the show…"}<span aria-hidden="true">↗</span></div></div>
      <div className="projector-qr">{qr ? <img src={qr} alt="Scan to join the audience orchestra" /> : <div className="qr-loading">Preparing join code…</div>}<strong>SCAN TO JOIN THE SHOW</strong></div></div>
    <div className="present-stats" aria-live="polite">{[["CONNECTED", counts?.connected], ["IN SYNC", counts?.synced], ["MUSIC READY", counts?.assetsReady]].map(([label, value]) => <div key={label}><strong>{offline ? "—" : value ?? "—"}</strong><span>{label}</span></div>)}<p>{counts?.stage === "performing" ? "The show is live. Enjoy your part." : counts?.stage === "calibrating" ? "Raise your phones toward the stage." : "Stay on the page. We’ll take it from here."}</p></div>
  </main>;
}
