export const MAP_CANVAS = { width: 900, height: 360, left: 20, top: 30, widthInner: 860, heightInner: 310 } as const;

export function mapToCanvas(point: { x: number; y: number }) {
  return { x: MAP_CANVAS.left + point.x * MAP_CANVAS.widthInner, y: MAP_CANVAS.top + point.y * MAP_CANVAS.heightInner };
}

// `point` is in CSS pixels relative to the rendered canvas. This inverse deliberately
// mirrors mapToCanvas so hit testing agrees with what the operator sees at any CSS scale.
export function canvasToMap(point: { x: number; y: number }, rect: { width: number; height: number }) {
  const scaleX = MAP_CANVAS.width / rect.width;
  const scaleY = MAP_CANVAS.height / rect.height;
  return {
    x: (point.x * scaleX - MAP_CANVAS.left) / MAP_CANVAS.widthInner,
    y: (point.y * scaleY - MAP_CANVAS.top) / MAP_CANVAS.heightInner,
  };
}
