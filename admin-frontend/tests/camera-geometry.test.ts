import { expect, test } from "bun:test";
import { anchorsError, cameraGeometry, sameGeometry, frameAnchors, usesFrameAnchors } from "../src/lib/camera-geometry";

test("new and legacy phone uploads request automatic layout on process while saved orientation survives reload", () => {
  const legacy = { rotationDegrees: 0 as const, anchors: null, exclusionRois: [] };
  expect(cameraGeometry()).toEqual({ ...legacy, frameLayout: "from-stage" });
  expect(sameGeometry(cameraGeometry(legacy), legacy)).toBe(false);
  const saved = { ...legacy, frameLayout: "from-back" as const };
  expect(sameGeometry(cameraGeometry(saved), saved)).toBe(true);
  expect(cameraGeometry({ ...saved, anchors: frameAnchors(100, 100, "from-stage") }).anchors).toEqual(frameAnchors(100, 100, "from-stage"));
});

test("stage-facing frame preset mirrors audience-left and places the near edge at the front", () => {
  expect(frameAnchors(1920, 1080, "from-stage")).toEqual([
    { x: 1919, y: 1079 }, { x: 0, y: 1079 }, { x: 0, y: 0 }, { x: 1919, y: 0 },
  ]);
  expect(anchorsError(frameAnchors(1920, 1080, "from-stage"), 1920, 1080)).toBeNull();
  expect(anchorsError(frameAnchors(1080, 1920, "from-back"), 1080, 1920)).toBeNull();
  expect(usesFrameAnchors(frameAnchors(1920, 1080, "from-stage"), 1920, 1080)).toBe(true);
  expect(usesFrameAnchors([{ x: 10, y: 99 }, { x: 90, y: 99 }, { x: 80, y: 20 }, { x: 20, y: 20 }], 100, 100)).toBe(false);
});

test("incomplete, crossed, degenerate and out-of-image seating anchors fail before processing", () => {
  expect(anchorsError([{ x: 0, y: 0 }])).toContain("four");
  expect(anchorsError([{ x: 0, y: 0 }, { x: 99, y: 99 }, { x: 0, y: 99 }, { x: 99, y: 0 }])).toContain("order");
  expect(anchorsError([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])).toContain("order");
  expect(anchorsError(frameAnchors(101, 100, "from-stage"), 100, 100)).toContain("inside");
});
