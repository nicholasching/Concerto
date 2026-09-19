import type { LocationData } from "@orchestra/contracts";

export interface SelectionPoint { x: number; y: number }
export interface DeviceSelection { mapRevision: number; deviceIds: number[] }

// Pure geometry: turn a drawn shape into an explicit device-ID set plus the map revision it was
// drawn on. No React, no canvas, no network. Map coordinates are normalized [0,1]: x=0 is the
// audience's left while facing the stage, y=0 nearest the stage, y=1 at the back.

export type SelectDevices = (locations: LocationData[], polygon: SelectionPoint[], mapRevision: number, options?: SelectionOptions) => DeviceSelection;

export interface SelectionOptions {
  // When true, only phones with a known position (status "localized") are eligible. Coarse,
  // ambiguous, and unseen phones are never returned because they have no x/y.
  includeLocalizedOnly?: boolean;
}

// A point in normalized map space. Returns false for null positions (coarse/ambiguous/unseen).
function locationPoint(location: LocationData): SelectionPoint | null {
  if (location.status !== "localized") return null;
  return { x: location.x, y: location.y };
}

// Ray-casting point-in-polygon test. A point exactly on an edge is treated as inside (inclusive),
// matching the "dots on the border count" choice documented in the subplot.
function pointInPolygon(point: SelectionPoint, polygon: SelectionPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const cross = (point.x - xi) * (yj - yi) - (point.y - yi) * (xj - xi);
    if (Math.abs(cross) <= 1e-10 && point.x >= Math.min(xi, xj) && point.x <= Math.max(xi, xj) && point.y >= Math.min(yi, yj) && point.y <= Math.max(yi, yj)) return true;
    const intersects = ((yi > point.y) !== (yj > point.y)) && (point.x <= (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

// Rectangle as a 2-point polygon [cornerA, cornerB]; normalized to a 4-point polygon so the same
// ray-cast path handles both boxes and freehand shapes.
export function rectanglePoints(cornerA: SelectionPoint, cornerB: SelectionPoint): SelectionPoint[] {
  const minX = Math.min(cornerA.x, cornerB.x);
  const maxX = Math.max(cornerA.x, cornerB.x);
  const minY = Math.min(cornerA.y, cornerB.y);
  const maxY = Math.max(cornerA.y, cornerB.y);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

export const selectDevices: SelectDevices = (locations, polygon, mapRevision, options) => {
  const includeLocalizedOnly = options?.includeLocalizedOnly ?? true;
  const ids: number[] = [];
  for (const location of locations) {
    const point = locationPoint(location);
    if (!point) {
      continue;
    }
    if (pointInPolygon(point, polygon)) ids.push(location.deviceId);
  }
  // Deduplicate while preserving discovery order. IDs are unique per location, but guard anyway.
  const seen = new Set<number>();
  void includeLocalizedOnly; // A region cannot locate a phone with null coordinates.
  const unique = ids.filter(id => seen.has(id) ? false : (seen.add(id), true));
  return { mapRevision, deviceIds: unique };
};

// Convenience: select with a rectangle (two corners) instead of an explicit polygon. Uses a direct
// inclusive bounds check so dots exactly on any edge count (inclusive borders, per the subplot).
export function selectRectangle(locations: LocationData[], cornerA: SelectionPoint, cornerB: SelectionPoint, mapRevision: number, options?: SelectionOptions): DeviceSelection {
  const includeLocalizedOnly = options?.includeLocalizedOnly ?? true;
  const minX = Math.min(cornerA.x, cornerB.x);
  const maxX = Math.max(cornerA.x, cornerB.x);
  const minY = Math.min(cornerA.y, cornerB.y);
  const maxY = Math.max(cornerA.y, cornerB.y);
  const seen = new Set<number>();
  const deviceIds: number[] = [];
  for (const location of locations) {
    if (location.status !== "localized") continue;
    const { x, y } = location;
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
      if (!seen.has(location.deviceId)) { seen.add(location.deviceId); deviceIds.push(location.deviceId); }
    }
  }
  void includeLocalizedOnly; // rectangles are localized-only by construction (no x/y => no match)
  return { mapRevision, deviceIds };
}
