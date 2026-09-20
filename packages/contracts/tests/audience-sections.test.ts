import { expect, test } from "bun:test";
import { splitAudience, sectionChannelsFor, type LocationData } from "../src";

const point = (deviceId: number, x: number, y = 0.5): LocationData => ({ deviceId, status: "localized", column: "center", x, y,
  sourceCameraIds: ["camera"], decodeScore: 1, mappingResidualPx: null, mappingMode: "frame-layout" });

test("quartiles follow device count on unevenly distributed coordinates, including ID zero", () => {
  const points = [0.01, 0.02, 0.03, 0.04, 0.1, 0.15, 0.8, 0.99].map((x, id) => point(id, x));
  const groups = splitAudience([...points].reverse());
  expect(groups.map(group => group.deviceIds)).toEqual([[0, 1], [2, 3], [4, 5], [6, 7]]);
  expect(groups.map(group => group.endX)).toEqual([0.025, 0.07, 0.47500000000000003, 1]);
});

test("empty, small and uneven crowds are balanced, disjoint and complete", () => {
  for (const n of [0, 1, 2, 3, 5, 7, 13, 1500]) {
    const groups = splitAudience(Array.from({ length: n }, (_, id) => point(id, id / Math.max(1, n))));
    const sizes = groups.map(group => group.deviceIds.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(groups.flatMap(group => group.deviceIds)).toEqual(Array.from({ length: n }, (_, id) => id));
    expect(groups.map(group => group.endX)).toEqual([...groups.map(group => group.endX)].sort((a, b) => a - b));
  }
});

test("ties use y then ID; coarse and unknown phones never enter optical quartiles", () => {
  const points = [point(4, 0.5, 0.9), point(3, 0.5, 0.2), point(1, 0.5, 0.2), point(0, 0.1)];
  const unknown: LocationData = { ...point(8, 0), status: "unseen", x: null, y: null, mappingMode: "none" };
  const coarse: LocationData = { ...point(9, 0), column: "left", status: "coarse", x: null, y: null, mappingMode: "optical-column" };
  expect(splitAudience([...points, unknown, coarse]).map(group => group.deviceIds)).toEqual([[0], [1], [3], [4]]);
  expect(splitAudience([...points].reverse())).toEqual(splitAudience(points));
});

test("section presets resolve old musical IDs by label and respect explicit silence", () => {
  const channels = ["Melody", "Vocals", "Percussion"].map((label, i) => ({ channelId: `old-${i}`, label, color: "#ffffff", gain: 1, mute: false, solo: false }));
  expect(sectionChannelsFor({ channels })).toEqual({ left: "old-0", "center-left": "old-1", "center-right": "old-1", right: "old-2" });
  const sectionChannels = { left: null, "center-left": "old-2", "center-right": "old-0", right: null };
  expect(sectionChannelsFor({ channels, sectionChannels })).toEqual(sectionChannels);
});
