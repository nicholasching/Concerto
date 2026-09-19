export interface ImagePoint { x: number; y: number }
export type CameraView = "from-stage" | "from-back";

/** Explicit full-frame preset; replace with seating corners for perspective calibration. */
export function frameAnchors(width: number, height: number, view: CameraView): ImagePoint[] {
  const right = width - 1, bottom = height - 1;
  return view === "from-stage"
    ? [{ x: right, y: bottom }, { x: 0, y: bottom }, { x: 0, y: 0 }, { x: right, y: 0 }]
    : [{ x: 0, y: 0 }, { x: right, y: 0 }, { x: right, y: bottom }, { x: 0, y: bottom }];
}

export function usesFrameAnchors(anchors: ImagePoint[] | null, width: number, height: number): boolean {
  return anchors?.length === 4 && (["from-stage", "from-back"] as const).some(view =>
    frameAnchors(width, height, view).every((point, index) => Math.abs(point.x - anchors[index].x) < 1 && Math.abs(point.y - anchors[index].y) < 1));
}

export function anchorsError(anchors: ImagePoint[] | null, width?: number, height?: number): string | null {
  if (!anchors) return null;
  if (anchors.length !== 4) return "Mark all four seating corners before saving geometry.";
  if (anchors.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0
    || width !== undefined && point.x >= width || height !== undefined && point.y >= height)) return "Seating corners must be inside the camera image.";
  const crosses = anchors.map((a, i) => {
    const b = anchors[(i + 1) % 4], c = anchors[(i + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  });
  const area = Math.abs(anchors.reduce((sum, a, i) => { const b = anchors[(i + 1) % 4]; return sum + a.x * b.y - b.x * a.y; }, 0)) / 2;
  return area < 16 || !crosses.every(value => value > 0) && !crosses.every(value => value < 0)
    ? "Choose four corners around the seating area in order; edges must not cross." : null;
}
