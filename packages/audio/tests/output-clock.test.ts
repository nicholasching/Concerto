import { expect, test } from "bun:test";
import { OutputClockReadiness, perfToAudioTime } from "../src";
import { asAudioContext, FakeAudioContext } from "./fake-audio";

test("running with zero timestamps is not ready for first playback", () => {
  const ctx = new FakeAudioContext(); ctx.state = "running";
  const readiness = new OutputClockReadiness();
  expect(readiness.ready(asAudioContext(ctx), 1000)).toBe(false);
  ctx.currentTime = 0.5;
  expect(readiness.ready(asAudioContext(ctx), 1500)).toBe(false);
  ctx.outputTimestamp = { contextTime: 0.4, performanceTime: 1490 };
  expect(readiness.ready(asAudioContext(ctx), 1500)).toBe(false);
  ctx.outputTimestamp = { contextTime: 0.7, performanceTime: 1790 };
  expect(readiness.ready(asAudioContext(ctx), 1800)).toBe(true);
});

test("output clock must settle again after interruption or a changed hardware mapping", () => {
  const ctx = new FakeAudioContext(); ctx.state = "running";
  const readiness = new OutputClockReadiness();
  const sample = (contextTime: number, now: number) => {
    ctx.outputTimestamp = { contextTime, performanceTime: now };
    return readiness.ready(asAudioContext(ctx), now);
  };
  expect(sample(1, 1000)).toBe(false);
  expect(sample(1.3, 1300)).toBe(true);
  expect(sample(1.5, 1800)).toBe(false); // output delay increased by 300 ms
  expect(sample(1.8, 2100)).toBe(true);
  ctx.state = "interrupted";
  expect(readiness.ready(asAudioContext(ctx), 2200)).toBe(false);
  ctx.state = "running";
  expect(sample(2, 2300)).toBe(false);
  expect(sample(2.3, 2600)).toBe(true);
  expect(readiness.ready(asAudioContext(ctx), 4000)).toBe(false); // frozen output
});

test("browsers without output timestamps warm an advancing clock and use latency only in fallback", () => {
  const ctx = { state: "running", currentTime: 2, baseLatency: 0.01, outputLatency: 0.12 };
  const readiness = new OutputClockReadiness();
  expect(readiness.ready(ctx, 1000)).toBe(false);
  ctx.currentTime = 2.3;
  expect(readiness.ready(ctx, 1300)).toBe(true);
  expect(perfToAudioTime(ctx, 3300, 1300)).toBeCloseTo(4.17, 9);
});

test("first cue maps to the same output time on devices with different output delays", () => {
  const startPerfMs = 3500;
  for (const outputDelaySeconds of [0.02, 0.12, 0.25]) {
    const ctx = new FakeAudioContext(); ctx.state = "running";
    const readiness = new OutputClockReadiness();
    ctx.currentTime = 3;
    ctx.outputTimestamp = { contextTime: 3 - outputDelaySeconds, performanceTime: 1000 };
    expect(readiness.ready(asAudioContext(ctx), 1000)).toBe(false);
    ctx.currentTime = 3.3;
    ctx.outputTimestamp = { contextTime: 3.3 - outputDelaySeconds, performanceTime: 1300 };
    expect(readiness.ready(asAudioContext(ctx), 1300)).toBe(true);
    const startAudio = perfToAudioTime(asAudioContext(ctx), startPerfMs, 1300);
    const audiblePerfMs = 1300 + (startAudio - ctx.outputTimestamp.contextTime!) * 1000;
    expect(audiblePerfMs).toBeCloseTo(startPerfMs, 7);
  }
});
