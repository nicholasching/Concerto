"use client";
import { useEffect, useRef, useState } from "react";
import { scheduleClick, type AudioContextHost, type ScheduledClick } from "@orchestra/audio";
import { fixtureClock } from "../lib/fixture-clock";

const LEAD_MS = 3000;

// Mock-only slice 1 check: plays one verified track 3 s ahead on the page's shared AudioContext.
export function AudioDemo({ host, buffer, trackId }: { host: AudioContextHost; buffer: AudioBuffer | null; trackId: string }) {
  const pending = useRef<ScheduledClick | null>(null);
  const [status, setStatus] = useState("Enable sound above first");

  useEffect(() => () => { if (pending.current?.status === "scheduled") pending.current.cancel(); }, []);

  function play() {
    if (!buffer) return;
    if (pending.current?.status === "scheduled") pending.current.cancel();
    pending.current = scheduleClick(host.context(), host.masterGain, buffer, fixtureClock, fixtureClock.nowServerMs() + LEAD_MS);
    setStatus(pending.current.status === "scheduled" ? `${trackId} scheduled at audio time ${pending.current.startAudioTime.toFixed(3)} s (${LEAD_MS / 1000} s ahead)` : "Start time already passed; not played");
  }

  return <section>
    <h2>Audio check (slice 1)</h2>
    <p className="notice">LOCAL FIXTURE CLOCK: NOT SYNCHRONIZED ACROSS DEVICES</p>
    <p className="status" role="status">{buffer ? status : "Enable sound above first"}</p>
    <button type="button" onClick={play} disabled={!buffer || host.state !== "running"}>Play test tone in 3 s</button>
  </section>;
}
