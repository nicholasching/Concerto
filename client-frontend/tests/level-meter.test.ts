import { expect, test } from "bun:test";
import { FLOOR, LevelMeter } from "../src/lib/level-meter";

/** Feeds a constant sine amplitude (0..1) so RMS is predictable. */
function meterAt(amplitudes: number[]): { meter: LevelMeter; step: () => number } {
  let amplitude = 0;
  const analyser = {
    fftSize: 0,
    getByteTimeDomainData(samples: Uint8Array) {
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = 128 + Math.round(127 * amplitude * Math.sin((2 * Math.PI * index) / 64));
      }
    },
    disconnect() {},
  } as unknown as AnalyserNode;
  const source = { connect() {}, disconnect() {} } as unknown as AudioNode;
  const meter = new LevelMeter({ createAnalyser: () => analyser }, source);
  let cursor = 0;
  return { meter, step: () => { amplitude = amplitudes[Math.min(cursor++, amplitudes.length - 1)]; return meter.read(); } };
}

function settle(step: () => number, frames: number): number {
  let level = 0;
  for (let index = 0; index < frames; index += 1) level = step();
  return level;
}

test("silence sits at the floor rather than going black", () => {
  const { step } = meterAt([0]);
  expect(settle(step, 60)).toBeCloseTo(FLOOR, 5);
});

test("a steady loud part climbs near full brightness", () => {
  const { step } = meterAt([1]);
  expect(settle(step, 30)).toBeGreaterThan(0.9);
});

test("a quiet stem still reaches full brightness", () => {
  const loud = settle(meterAt([1]).step, 30);
  const quiet = settle(meterAt([0.05]).step, 30);
  expect(quiet).toBeGreaterThan(0.9);
  expect(Math.abs(quiet - loud)).toBeLessThan(0.05);
});

test("brightness decays toward the floor when the part drops out", () => {
  const silent = meterAt([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
  const peak = settle(silent.step, 10);
  const afterOne = silent.step();
  const afterMany = settle(silent.step, 200);
  expect(peak).toBeGreaterThan(0.9);
  expect(afterOne).toBeLessThan(peak);
  expect(afterMany).toBeCloseTo(FLOOR, 2);
});

test("a transient rises faster than it falls", () => {
  const rising = meterAt([0, 1]);
  settle(rising.step, 1);
  const attack = rising.step() - FLOOR;
  const falling = meterAt([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
  const peak = settle(falling.step, 10);
  const release = peak - falling.step();
  expect(attack).toBeGreaterThan(release);
});
