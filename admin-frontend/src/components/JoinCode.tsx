"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { participantLink, participantLinkKey } from "../lib/participant-link";

export function JoinCode({ sessionId }: { sessionId: string }) {
  const [link, setLink] = useState("");
  const [image, setImage] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  function defaultLink() { return participantLink(process.env.NEXT_PUBLIC_PARTICIPANT_URL ?? `${window.location.protocol}//${window.location.hostname}:3000`, sessionId); }
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(participantLinkKey(sessionId)); } catch { /* browser storage unavailable */ }
    let next: string;
    try { next = participantLink(saved || defaultLink(), sessionId); }
    catch { next = defaultLink(); }
    setLink(next); setDraft(next); setError(null);
  }, [sessionId]);
  useEffect(() => {
    let current = true; setImage("");
    if (link) void QRCode.toDataURL(link, { width: 240, margin: 2, errorCorrectionLevel: "M" })
      .then(value => { if (current) setImage(value); }).catch(() => { if (current) setError("Could not create the QR code for this URL."); });
    return () => { current = false; };
  }, [link]);
  function save() {
    try {
      const next = participantLink(draft, sessionId);
      setLink(next); setDraft(next); setError(null);
      try { localStorage.setItem(participantLinkKey(sessionId), next); } catch { /* use for this page only */ }
    } catch { setError("Enter a complete audience URL, such as https://your-name.trycloudflare.com."); }
  }
  function reset() {
    try { localStorage.removeItem(participantLinkKey(sessionId)); } catch { /* page-only */ }
    const next = defaultLink(); setLink(next); setDraft(next); setError(null);
  }
  return <div className="qr-box">{image && <img src={image} width={240} height={240} alt="Scan to join this concert" />}
    <label>Participant link <input aria-label="Participant link" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} /></label>
    <div className="actions"><button type="button" onClick={save}>Use participant link</button><button type="button" onClick={reset}>Reset link</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    {link && <a href={link} target="_blank" rel="noreferrer">Open audience client</a>}
    <p>Paste your Cloudflare HTTPS URL and select Use participant link. The QR code includes this session and remembers the link in this browser. Localhost works only on this computer.</p>
  </div>;
}
