"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { participantLink } from "../../lib/participant-link";
import { Star } from "../star";

type Counts = { sessionId: string; connected: number; synced: number; soundReady: number; assetsReady: number; mapped: number; stage: string };

export default function PresentPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [offline, setOffline] = useState(false);
  const [qr, setQr] = useState("");

  useEffect(() => {
    let stopped = false;
    const read = async () => {
      try {
        const response = await fetch("/api/presentation", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!stopped) { setCounts(data); setOffline(false); }
      } catch { if (!stopped) setOffline(true); }
    };
    void read();
    const timer = setInterval(read, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!counts?.sessionId) return;
    let current = true;
    let url: string;
    try { url = participantLink(process.env.NEXT_PUBLIC_PARTICIPANT_URL ?? window.location.origin, counts.sessionId); }
    catch { url = participantLink(window.location.origin, counts.sessionId); }
    void QRCode.toDataURL(url, { width: 1000, margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b0b0b", light: "#ffffff" } })
      .then(value => { if (current) setQr(value); });
    return () => { current = false; };
  }, [counts?.sessionId]);

  const calibrating = counts?.stage === "calibrating";

  // Real session counts only. When the feed is down we blank the numbers rather than leave a
  // stale figure sitting under a label that claims it is live.
  const tallies = [
    { label: "Connected", value: counts?.connected },
    { label: "In sync", value: counts?.synced },
    { label: "Music ready", value: counts?.assetsReady },
  ];

  return <main className="stage">
    <p className="stage-name"><Star />Concerto</p>

    <div className="stage-body">
      <div className="stage-lead">
        <p className="stage-say">{calibrating ? "Hold your phones up." : "Scan to join."}</p>
        <p className="stage-cue" aria-live="polite">
          {offline ? "Reconnecting\u2026" : calibrating ? "Screen facing the stage." : "Point your camera here."}
        </p>
      </div>

      <div className="qr">
        {qr ? <img src={qr} alt="Scan this code to join" /> : <div className="qr-wait">Loading…</div>}
      </div>
    </div>

    <div className="tallies">
      {tallies.map(tally => <div className="tally" key={tally.label}>
        <b>{offline || tally.value === undefined ? "" : tally.value}</b>
        <span>{tally.label}</span>
      </div>)}
    </div>
  </main>;
}
