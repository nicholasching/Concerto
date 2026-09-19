import { expect, test } from "bun:test";
import { unlockWithin } from "../src/lib/audio-unlock";

function fakeTimers() {
  let fire: (() => void) | null = null;
  let cleared = 0;
  return { timers: { setTimeout: (callback: () => void) => { fire = callback; return 1; }, clearTimeout: () => { cleared += 1; } }, fire: () => fire?.(), cleared: () => cleared };
}

test("an unlock that resolves reports running and clears the timer", async () => {
  const t = fakeTimers();
  expect(await unlockWithin(async () => {}, t.timers)).toEqual({ kind: "running" });
  expect(t.cleared()).toBe(1);
});

test("an unlock that never resolves reports a timeout instead of hanging", async () => {
  const t = fakeTimers();
  const outcome = unlockWithin(() => new Promise<void>(() => {}), t.timers);
  t.fire();
  expect(await outcome).toEqual({ kind: "timeout" });
});

test("an unlock that throws reports the error", async () => {
  const t = fakeTimers();
  expect(await unlockWithin(async () => { throw new Error("AudioContext is suspended after unlock"); }, t.timers)).toEqual({ kind: "error", message: "AudioContext is suspended after unlock" });
});
