import { expect, test } from "bun:test";
import type { LocationData } from "@orchestra/contracts";
import { selectDevices, selectRectangle, rectanglePoints } from "../src";

function localized(deviceId: number, x: number, y: number): LocationData {
  return { deviceId, column: "center", sourceCameraIds: ["cam-a"], decodeScore: 0.9, mappingResidualPx: 0, status: "localized", x, y, mappingMode: "manual-anchors" };
}
function coarse(deviceId: number): LocationData {
  return { deviceId, column: "center", sourceCameraIds: ["cam-a"], decodeScore: null, mappingResidualPx: null, status: "coarse", x: null, y: null, mappingMode: "manual-column" };
}
function unseen(deviceId: number): LocationData {
  return { deviceId, column: null, sourceCameraIds: [], decodeScore: null, mappingResidualPx: null, status: "unseen", x: null, y: null, mappingMode: "none" };
}

const locations: LocationData[] = [
  localized(0, 0.10, 0.10), localized(1, 0.50, 0.10), localized(2, 0.90, 0.10),
  localized(3, 0.10, 0.90), localized(4, 0.50, 0.90), localized(5, 0.90, 0.90),
  coarse(6), unseen(7),
];

test("rectangle selects the audience-left corner and returns explicit IDs plus mapRevision", () => {
  const result = selectRectangle(locations, { x: 0, y: 0 }, { x: 0.2, y: 0.2 }, 42);
  expect(result).toEqual({ mapRevision: 42, deviceIds: [0] });
});

test("orientation: audience-left is x=0 while facing the stage, so a left box selects device 0 not 2", () => {
  const left = selectRectangle(locations, { x: 0, y: 0 }, { x: 0.2, y: 0.2 }, 1);
  const right = selectRectangle(locations, { x: 0.8, y: 0 }, { x: 1, y: 0.2 }, 1);
  expect(left.deviceIds).toEqual([0]);
  expect(right.deviceIds).toEqual([2]);
});

test("border dots are inclusive (a dot on the rectangle edge counts)", () => {
  const edge = selectRectangle(locations, { x: 0.10, y: 0 }, { x: 1, y: 1 }, 1);
  // device 0 sits exactly on x=0.10; inclusive border keeps it.
  expect(edge.deviceIds).toContain(0);
});

test("coarse and unseen phones are excluded by default (no x/y)", () => {
  const all = selectRectangle(locations, { x: 0, y: 0 }, { x: 1, y: 1 }, 1);
  expect(all.deviceIds).not.toContain(6);
  expect(all.deviceIds).not.toContain(7);
  expect(all.deviceIds).toEqual([0, 1, 2, 3, 4, 5]);
});

test("a freehand polygon selects the enclosed dots only", () => {
  // A small triangle in the bottom region: encloses device 4 (0.50, 0.90), excludes the top row.
  const triangle: { x: number; y: number }[] = [
    { x: 0.50, y: 0.80 }, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 },
  ];
  const result = selectDevices(locations, triangle, 7);
  expect(result.mapRevision).toBe(7);
  expect(result.deviceIds).toContain(4);
  expect(result.deviceIds).not.toContain(1);
});

test("no duplicate IDs even if a location could match twice", () => {
  const result = selectRectangle(locations, { x: 0, y: 0 }, { x: 1, y: 1 }, 1);
  expect(new Set(result.deviceIds).size).toBe(result.deviceIds.length);
});

test("rectanglePoints builds a normalized four-point polygon regardless of corner order", () => {
  const a = rectanglePoints({ x: 0.9, y: 0.9 }, { x: 0.1, y: 0.1 });
  const b = rectanglePoints({ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 });
  expect(a).toEqual(b);
  expect(a).toHaveLength(4);
  expect(a[0]).toEqual({ x: 0.1, y: 0.1 });
  expect(a[2]).toEqual({ x: 0.9, y: 0.9 });
});

test("1500-point selection completes in well under the 100ms target", () => {
  const big: LocationData[] = Array.from({ length: 1500 }, (_, i) => localized(i, (i % 30) / 30, Math.floor(i / 30) / 50));
  const start = performance.now();
  const result = selectRectangle(big, { x: 0, y: 0 }, { x: 1, y: 1 }, 1);
  const elapsed = performance.now() - start;
  expect(result.deviceIds).toHaveLength(1500);
  expect(elapsed).toBeLessThan(100);
});
