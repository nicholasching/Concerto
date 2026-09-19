import { expect, test } from "bun:test";
import type { LocationData } from "@orchestra/contracts";
import { selectRegion } from "../src";

test("drawn divider regions partition located phones without duplicating boundary phones", () => {
  const locations: LocationData[] = [0, 0.4, 0.5, 0.6, 1].map((x, deviceId) => ({
    deviceId, x, y: 0.5, column: "center", status: "localized", mappingMode: "manual-anchors",
    sourceCameraIds: ["camera-center"], decodeScore: 1, mappingResidualPx: null,
  }));
  locations.push({ deviceId: 9, x: null, y: null, column: "left", status: "coarse", mappingMode: "optical-column", sourceCameraIds: ["camera-left"], decodeScore: 1, mappingResidualPx: null });
  expect(selectRegion(locations, "left", [0.4, 0.6], 17)).toEqual({ mapRevision: 17, deviceIds: [0] });
  expect(selectRegion(locations, "center", [0.4, 0.6], 17).deviceIds).toEqual([1, 2]);
  expect(selectRegion(locations, "right", [0.4, 0.6], 17).deviceIds).toEqual([3, 4]);
  expect(selectRegion(locations, "left", [0.55, 0.8], 18).deviceIds).toEqual([0, 1, 2]);
  expect(() => selectRegion(locations, "center", [0.8, 0.2], 17)).toThrow(RangeError);
});
