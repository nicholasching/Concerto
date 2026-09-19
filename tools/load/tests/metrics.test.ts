import { describe, expect, test } from "bun:test";
import { formatSummary, rate, summarize } from "../metrics";

describe("summarize", () => {
  test("reports percentiles over a known set", () => {
    const summary = summarize(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(summary).toMatchObject({ count: 100, p50: 51, p95: 96, p99: 100, max: 100 });
  });

  test("a single sample is its own every percentile", () => {
    expect(summarize([7])).toEqual({ count: 1, p50: 7, p95: 7, p99: 7, max: 7 });
  });

  test("an empty set reports nothing rather than pretending", () => {
    expect(summarize([])).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });

  test("order of arrival does not change the result", () => {
    expect(summarize([9, 1, 5, 3, 7])).toEqual(summarize([1, 3, 5, 7, 9]));
  });
});

describe("reporting", () => {
  test("a rate always carries both counts", () => {
    expect(rate(1485, 1500)).toBe("1485/1500 (99.0%)");
  });

  test("no eligible clients is stated, not divided by zero", () => {
    expect(rate(0, 0)).toBe("0/0 (no eligible clients)");
  });

  test("a formatted summary names its unit", () => {
    expect(formatSummary("cue margin", summarize([10, 20, 30]))).toContain("p50=20.0ms");
  });
});
