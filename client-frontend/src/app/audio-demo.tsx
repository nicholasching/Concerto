"use client";
import { useEffect, useRef, useState } from "react";
import { AudioContextHost, DecodedBudget, loadTrack, scheduleClick, type LoadedTrack, type ScheduledClick, type TrackData } from "@orchestra/audio";
import { fixtureClock } from "../lib/fixture-clock";

const LEAD_MS = 3000;

// Mock-only slice 1 check: unlock, hash-verified preload, and one scheduled tone.
export function AudioDemo({ track, api }: { track: TrackData; api: string }) {
  const host = useRef<AudioContextHost | null>(null);
  const loaded = useRef<LoadedTrack | null>(null);
  const pending = useRef<ScheduledClick | null>(null);
  const [status, setStatus] = useState("Audio locked");
  const [ready, setReady] = useState(false);

  useEffect(() => () => {
    if (pending.current?.status === "scheduled") pending.current.cancel();
    void host.current?.dispose();
  }, []);

  async function enable() {
    if (!host.current) {
      host.current = new AudioContextHost();
      host.current.onStateChange(state => { if (state !== "running") { setReady(false); setStatus(`Audio ${state}. Tap Enable sound to resume.`); } });
    }
    const audio = host.current;
    try {
      setStatus("Unlocking audio...");
      await audio.unlock();
      setStatus(`Loading ${track.trackId}...`);
      loaded.current ??= await loadTrack(track, { ctx: audio.context(), budget: new DecodedBudget(), baseUrl: api });
      setReady(true);
      setStatus(`${track.trackId} decoded, sha256 verified (${(loaded.current.decodedBytes / 1e6).toFixed(2)} MB decoded)`);
    } catch (error) {
      setReady(false);
      setStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function play() {
    const audio = host.current;
    if (!audio || !loaded.current) return;
    if (pending.current?.status === "scheduled") pending.current.cancel();
    pending.current = scheduleClick(audio.context(), audio.masterGain, loaded.current.buffer, fixtureClock, fixtureClock.nowServerMs() + LEAD_MS);
    setStatus(pending.current.status === "scheduled" ? `Tone scheduled at audio time ${pending.current.startAudioTime.toFixed(3)} s (${LEAD_MS / 1000} s ahead)` : "Start time already passed; not played");
  }

  return <section>
    <h2>Audio check (slice 1)</h2>
    <p className="notice">LOCAL FIXTURE CLOCK: NOT SYNCHRONIZED ACROSS DEVICES</p>
    <p className="status" role="status">{status}</p>
    <button type="button" onClick={enable}>Enable sound</button>{" "}
    <button type="button" onClick={play} disabled={!ready}>Play test tone in 3 s</button>
  </section>;
}
