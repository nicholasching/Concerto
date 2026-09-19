import type { SynchronizedClock } from "@orchestra/sync";
import { serverMsToAudioTime } from "./timing";

export type ScheduledClick =
  | { status: "scheduled"; startAudioTime: number; cancel(): void }
  | { status: "late"; lateBySeconds: number };

// Starts a buffer at a common server time. A start already in the past is refused;
// the caller must pick a new future rendezvous instead of playing late.
export function scheduleClick(ctx: AudioContext, output: AudioNode, buffer: AudioBuffer, clock: SynchronizedClock, serverStartMs: number, nowPerfMs?: number): ScheduledClick {
  const when = serverMsToAudioTime(clock, ctx, serverStartMs, nowPerfMs);
  if (when <= ctx.currentTime) return { status: "late", lateBySeconds: ctx.currentTime - when };
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(output);
  let finished = false;
  source.onended = () => { finished = true; source.disconnect(); };
  source.start(when);
  return {
    status: "scheduled",
    startAudioTime: when,
    cancel() {
      if (finished) return;
      finished = true;
      source.stop();
      source.disconnect();
    },
  };
}
