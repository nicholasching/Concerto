export interface Summary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export const summarize = (values: readonly number[]): Summary => {
  if (values.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1] };
};

export const formatSummary = (label: string, summary: Summary, unit = "ms"): string =>
  `${label}: n=${summary.count} p50=${summary.p50.toFixed(1)}${unit} p95=${summary.p95.toFixed(1)}${unit} ` +
  `p99=${summary.p99.toFixed(1)}${unit} max=${summary.max.toFixed(1)}${unit}`;

// Reported as a fraction with both counts, never as a bare percentage: "99%" of an unknown
// denominator is the kind of number that hides an excluded half of the room.
export const rate = (achieved: number, eligible: number): string =>
  `${achieved}/${eligible}` + (eligible > 0 ? ` (${((achieved / eligible) * 100).toFixed(1)}%)` : " (no eligible clients)");
