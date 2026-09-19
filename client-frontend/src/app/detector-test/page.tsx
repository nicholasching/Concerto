"use client";

import { useEffect, useRef, useState } from "react";
import { detectorColorAt, detectorStageAt } from "../../lib/detector-test";

const COLORS = { amber: "#ffb000", blue: "#0066ff" } as const;
type ColorName = keyof typeof COLORS;

export default function DetectorTestPage() {
  const [colorName, setColorName] = useState<ColorName>("amber");
  const [deviceId, setDeviceId] = useState(1);
  const [runTag, setRunTag] = useState(37);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (startedAt === null) return;
    const tick = () => { setNow(performance.now()); frame.current = requestAnimationFrame(tick); };
    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [startedAt]);

  const elapsedMs = startedAt === null ? -1 : now - startedAt;
  const stage = detectorStageAt(elapsedMs, deviceId, runTag);
  const active = startedAt !== null;
  const color = detectorColorAt(elapsedMs, COLORS[colorName], deviceId, runTag);

  function start() {
    void document.documentElement.requestFullscreen?.().catch(() => {});
    setNow(performance.now());
    setStartedAt(performance.now());
  }

  return <main className={active ? "detector-active" : "detector-setup"} style={active ? { background: color } : undefined}>
    {!active && <section>
      <p className="eyebrow">LOCAL DETECTOR TEST</p>
      <h1>Flash and palette test</h1>
      <p>Scan this QR code on each test phone. It renders the exact 11-second OTC calibration packet, then holds its selected calibration color.</p>
      <img className="detector-qr" src="/detector-test/qr" width={280} height={280} alt="Scan to open the detector flash test" />
      <label>Device ID <input type="number" min="0" max="2047" value={deviceId} onChange={event => setDeviceId(Math.max(0, Math.min(2047, Number(event.target.value) || 0)))} /></label>
      <label>Run tag <input type="number" min="0" max="255" value={runTag} onChange={event => setRunTag(Math.max(0, Math.min(255, Number(event.target.value) || 0)))} /></label>
      <label>Hold color <select value={colorName} onChange={event => setColorName(event.target.value as ColorName)}>
        <option value="amber">Amber / yellow</option><option value="blue">Blue</option>
      </select></label>
      <p className="muted">Use a phone-reachable HTTPS URL. A QR code containing localhost works only on this computer.</p>
      <button type="button" onClick={start}>Start flash sequence</button>
    </section>}
    {active && <div className="detector-controls">
      <p>{stage === "packet" ? `Running OTC packet for device ${deviceId}, tag ${runTag}` : `Holding ${colorName}`}</p>
      <button type="button" onClick={start}>Restart flash sequence</button>
      <button type="button" onClick={() => setStartedAt(null)}>Exit test</button>
    </div>}
  </main>;
}
