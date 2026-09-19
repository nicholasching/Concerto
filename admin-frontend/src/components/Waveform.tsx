"use client";
import { useEffect, useState } from "react";
import type { ShowData } from "@orchestra/contracts";
import { api } from "../lib/useSnapshot";

const cache = new Map<string, Promise<number[]>>();
let queue = Promise.resolve();
function peaks(track: ShowData["tracks"][number]): Promise<number[]> {
  const existing = cache.get(track.sha256); if (existing) return existing;
  // Decode once on the operator only, sequentially. No waveform work touches participant audio.
  const pending = queue.then(async () => {
    const context = new AudioContext();
    try {
      const response = await fetch(new URL(track.url, api)); if (!response.ok) throw new Error("Audio unavailable");
      const decoded = await context.decodeAudioData(await response.arrayBuffer());
      const samples = decoded.getChannelData(0), count = 240, step = Math.max(1, Math.ceil(samples.length / count));
      return Array.from({ length: count }, (_, index) => {
        let peak = 0; for (let i = index * step; i < Math.min(samples.length, (index + 1) * step); i += 8) peak = Math.max(peak, Math.abs(samples[i]));
        return peak;
      });
    } finally { await context.close(); }
  });
  queue = pending.then(() => {}, () => {}); cache.set(track.sha256, pending); return pending;
}
export function Waveform({ track, offsetMs, durationMs }: { track: ShowData["tracks"][number]; offsetMs: number; durationMs: number }) {
  const [values, setValues] = useState<number[]>([]);
  useEffect(() => { let active = true; void peaks(track).then(values => { if (active) setValues(values); }, () => {}); return () => { active = false; }; }, [track.sha256]);
  const visible = values.slice(Math.floor(offsetMs / track.durationMs * values.length), Math.max(1, Math.ceil((offsetMs + durationMs) / track.durationMs * values.length)));
  const max = Math.max(0.01, ...visible);
  return <svg className="waveform" viewBox={`0 0 ${Math.max(1, visible.length)} 40`} preserveAspectRatio="none" aria-label={`Waveform for ${track.label}`} role="img">
    {visible.map((value, index) => <line key={index} x1={index} x2={index} y1={20 - value / max * 18} y2={20 + value / max * 18} stroke="currentColor" strokeWidth={0.7} />)}
  </svg>;
}
