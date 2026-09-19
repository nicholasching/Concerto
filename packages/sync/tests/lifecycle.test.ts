import { expect, test } from "bun:test";
import { ClockSync, type Probe } from "../src/lifecycle";

test("probe pairs correlate replies, converge, and invalidate on disconnect and new epoch", () => {
  let now = 1_000_000, next = 0;
  const queue = new Map<number, { at: number; callback: () => void }>();
  const sent: Probe[] = [];
  const timers = { setTimeout(callback: () => void, ms: number) { const id = ++next; queue.set(id, { at: now + ms, callback }); return id; }, clearTimeout(id: unknown) { queue.delete(id as number); } };
  const clock = new ClockSync({ now: () => now, timers, random: () => 0, send(probe) {
    sent.push(probe);
    timers.setTimeout(() => clock.accept({ ...probe, serverEpoch: "a", t1: probe.t0 + 502, t2: probe.t0 + 502 }), 4);
  } });
  const advance = (ms: number) => { const end = now + ms; for (;;) {
    const first = [...queue].sort((a, b) => a[1].at - b[1].at)[0];
    if (!first || first[1].at > end) break;
    queue.delete(first[0]); now = first[1].at; first[1].callback();
  } now = end; };
  clock.start("a"); advance(2000);
  expect(clock.quality().ready).toBe(true);
  expect(clock.nowServerMs()).toBe(now + 500);
  expect(sent[1].t0 - sent[0].t0).toBe(25);
  const old = sent.at(-1)!;
  clock.stop(); expect(clock.quality().ready).toBe(false); expect(queue.size).toBe(0);
  clock.start("b"); clock.accept({ ...old, serverEpoch: "a", t1: old.t0, t2: old.t0 });
  expect(clock.quality().ready).toBe(false);
  clock.stop();
});

test("default timer wrapper calls the host timer without a foreign receiver", async () => {
  const native = globalThis.setTimeout;
  let validReceiver = false;
  globalThis.setTimeout = function (this: unknown, callback: TimerHandler, ms?: number) {
    validReceiver = this === undefined || this === globalThis;
    return native(callback, ms);
  } as typeof setTimeout;
  const clock = new ClockSync({ random: () => 0, send: () => {} });
  try { clock.start("browser"); expect(validReceiver).toBe(true); }
  finally { clock.stop(); globalThis.setTimeout = native; }
});

test("a lost steady-state pair is retried before a ready clock expires", () => {
  let now = 1_000_000, next = 0, dropGroup: number | null = null;
  const queue = new Map<number, { at: number; callback: () => void }>();
  const timers = { setTimeout(callback: () => void, ms: number) { const id = ++next; queue.set(id, { at: now + ms, callback }); return id; }, clearTimeout(id: unknown) { queue.delete(id as number); } };
  const clock = new ClockSync({ now: () => now, timers, random: () => 0, send(probe) {
    if (probe.probeGroupId === dropGroup) return;
    timers.setTimeout(() => clock.accept({ ...probe, serverEpoch: "a", t1: probe.t0 + 2, t2: probe.t0 + 2 }), 4);
  } });
  const advance = (ms: number) => { const end = now + ms; for (;;) {
    const first = [...queue].sort((a, b) => a[1].at - b[1].at)[0];
    if (!first || first[1].at > end) break;
    queue.delete(first[0]); now = first[1].at; first[1].callback();
  } now = end; };
  clock.start("a"); advance(2000); expect(clock.quality().ready).toBe(true);
  dropGroup = clock.estimator.stats().probeGroupsStarted;
  const before = clock.estimator.stats().pairsPure;
  advance(2600);
  expect(clock.estimator.stats().pairsPure).toBeGreaterThan(before);
  expect(clock.quality().ready).toBe(true);
  clock.stop();
});
