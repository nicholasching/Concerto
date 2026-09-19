import { expect, test } from "bun:test";
import { canvasToMap, MAP_CANVAS, mapToCanvas } from "../src/lib/mapGeometry";

test("visible map coordinates round-trip through the padded canvas transform", () => {
  const visible = mapToCanvas({ x: 0.1, y: 0.1 });
  expect(visible).toEqual({ x: 106, y: 61 });
  expect(canvasToMap(visible, { width: MAP_CANVAS.width, height: MAP_CANVAS.height })).toEqual({ x: 0.1, y: 0.1 });
});

test("inverse transform accounts for CSS canvas scaling", () => {
  const visible = mapToCanvas({ x: 1, y: 1 });
  expect(canvasToMap({ x: visible.x / 2, y: visible.y / 2 }, { width: MAP_CANVAS.width / 2, height: MAP_CANVAS.height / 2 })).toEqual({ x: 1, y: 1 });
});
