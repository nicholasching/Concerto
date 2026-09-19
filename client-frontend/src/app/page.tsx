"use client";
import { useEffect, useState } from "react";
import { ParticipantSnapshot, type ParticipantSnapshotData } from "@orchestra/contracts";
import { participantStatus } from "../lib/status";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const mock = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "1";

export default function Page() {
  const [snapshot, setSnapshot] = useState<ParticipantSnapshotData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!mock) return;
    const controller = new AbortController();
    fetch(`${api}/api/sessions/demo/snapshot?role=participant`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return ParticipantSnapshot.parse(await response.json()); })
      .then(setSnapshot).catch(error => { if (!controller.signal.aborted) setError(String(error)); });
    return () => controller.abort();
  }, []);
  return <main>
    <p className="eyebrow">AUDIENCE ORCHESTRA / TEAM 2</p>
    <h1>Audience client</h1>
    <p className="notice">{mock ? "SYNTHETIC FIXTURE PREVIEW" : "FOUNDATION SHELL"}</p>
    <p>The client workspace and protocol are ready for development. This shell does not register a phone, flash a calibration, or play sound.</p>
    {error && <p role="alert">Fixture server: {error}</p>}
    {snapshot && <section>
      <h2>Fixture device {snapshot.deviceId}</h2>
      <p className="status">{participantStatus(snapshot)}</p>
      <p>Location: {snapshot.location.status} / {snapshot.location.column ?? "unknown"}</p>
      <p>{snapshot.show.channels.length} prepared channel definitions</p>
    </section>}
    <section><h2>First team milestone</h2><p>Extract audio and clock adapters, implement join and audio unlock, then render the frozen OTC packet. Follow .devcontext/stages/02-audio-client.md.</p></section>
  </main>;
}
