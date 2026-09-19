"use client";
import { useEffect, useState } from "react";
import { AdminSnapshot, type AdminSnapshotData } from "@orchestra/contracts";
import { audienceSummary } from "../lib/summary";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const mock = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "1";

export default function Page() {
  const [snapshot, setSnapshot] = useState<AdminSnapshotData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!mock) return;
    const controller = new AbortController();
    fetch(`${api}/api/sessions/demo/snapshot`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return AdminSnapshot.parse(await response.json()); })
      .then(setSnapshot).catch(error => { if (!controller.signal.aborted) setError(String(error)); });
    return () => controller.abort();
  }, []);
  const summary = snapshot ? audienceSummary(snapshot) : null;
  return <main>
    <p className="eyebrow">AUDIENCE ORCHESTRA / TEAM 4</p>
    <h1>Admin console</h1>
    <p className="notice">{mock ? "SYNTHETIC FIXTURE PREVIEW" : "FOUNDATION SHELL"}</p>
    <p>Shared schemas and this read-only preview are ready. Uploads, selection, assignments, and transport controls are Team 4's implementation work.</p>
    {error && <p role="alert">Fixture server: {error}</p>}
    {snapshot && summary && <>
      <section><h2>Fixture readiness</h2><div className="stats">{Object.entries(summary).map(([label, value]) => <p key={label}><strong>{value}</strong><br />{label}</p>)}</div></section>
      <section><h2>Audience map / synthetic</h2><p>Stage at top. Audience-left is on the left.</p>
        <svg viewBox="0 0 900 360" role="img" aria-label="Synthetic audience locations">
          <rect x="300" y="0" width="300" height="18" fill="#6379ba" />
          {snapshot.audienceMap.locations.filter(location => location.status === "localized").map(location => <circle key={location.deviceId} cx={20 + (location.x ?? 0) * 860} cy={30 + (location.y ?? 0) * 310} r="2" fill="#71d0b0" />)}
        </svg>
      </section>
      <section><h2>Prepared channel definitions</h2>{snapshot.show.channels.map(channel => <div className="lane" key={channel.channelId} style={{ borderColor: channel.color }}>{channel.label}<span>8 s synthetic test tone</span></div>)}</section>
    </>}
    <section><h2>First team milestone</h2><p>Build the calibration review and selection workflow against fixtures. Follow .devcontext/stages/04-admin-console.md.</p></section>
  </main>;
}
