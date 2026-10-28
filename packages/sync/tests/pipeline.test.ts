import { expect, test } from "bun:test";
import { ClockEstimator } from "../src/estimator";

test("interleaved pairs retain their own first measurement and timed-out pairs are discarded", () => {
  let now = 1000;
  const estimator = new ClockEstimator({ now: () => now, minMeasurements: 1 });
  const accept = (id: number, index: 0 | 1, t0: number) => {
    now = t0 + 200;
    return estimator.accept({ serverEpoch: "epoch", probeGroupId: id, probeGroupIndex: index,
      t0, t1: t0 + 100, t2: t0 + 100 });
  };
  accept(1, 0, 1000); accept(2, 0, 1010);
  expect(accept(1, 1, 1025)).not.toBeNull();
  expect(accept(2, 1, 1035)).not.toBeNull();
  expect(estimator.stats().pairsPure).toBe(2);
  accept(3, 0, 1050); estimator.discardProbeGroup(3);
  expect(accept(3, 1, 1075)).toBeNull();
  expect(estimator.stats().pairsPure).toBe(2);
});
