import { describe, expect, test } from "bun:test";
import { LoopLagSampler } from "../src/loop-lag";

describe("event-loop lag sampling", () => {
  test("reports percentiles from delay samples", () => {
    const sampler = new LoopLagSampler();
    for (const delay of [5, 1, 4, 2, 3]) sampler.record(delay);

    expect(sampler.summary()).toEqual({ count: 5, p50: 3, p95: 5, p99: 5, max: 5 });
  });

  test("bounds retained history to the newest samples", () => {
    const sampler = new LoopLagSampler(100, 3);
    for (const delay of [1, 2, 3, 100]) sampler.record(delay);

    expect(sampler.summary()).toEqual({ count: 3, p50: 3, p95: 100, p99: 100, max: 100 });
  });

  test("reset starts a fresh measurement window", () => {
    const sampler = new LoopLagSampler();
    sampler.record(20);
    sampler.reset();

    expect(sampler.summary()).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});
