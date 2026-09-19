"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function JoinCode({ sessionId }: { sessionId: string }) {
  const [link, setLink] = useState("");
  const [image, setImage] = useState("");
  useEffect(() => {
    const url = new URL(process.env.NEXT_PUBLIC_PARTICIPANT_URL ?? `${window.location.protocol}//${window.location.hostname}:3000`);
    url.searchParams.set("session", sessionId); setLink(url.toString());
  }, [sessionId]);
  useEffect(() => { if (link) void QRCode.toDataURL(link, { width: 240, margin: 2, errorCorrectionLevel: "M" }).then(setImage); }, [link]);
  return <div className="qr-box">{image && <img src={image} width={240} height={240} alt="Scan to join this concert" />}
    <label>Participant link <input aria-label="Participant link" value={link} onChange={e => setLink(e.target.value)} /></label>
    {link && <a href={link} target="_blank" rel="noreferrer">Open audience client</a>}
    <p>For phones, use a reachable HTTPS address. A localhost link works on this computer.</p>
  </div>;
}
