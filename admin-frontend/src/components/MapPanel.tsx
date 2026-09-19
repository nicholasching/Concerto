"use client";
import { useEffect, useRef, useState } from "react";
import type { AdminSnapshotData } from "@orchestra/contracts";
import { selectDevices, selectRectangle } from "@orchestra/selection";
import type { DeviceSelection } from "@orchestra/selection";
import { canvasToMap, MAP_CANVAS, mapToCanvas } from "../lib/mapGeometry";

type AssignmentData = AdminSnapshotData["assignments"][number];
type AudienceMapData = AdminSnapshotData["audienceMap"];
type ChannelData = AdminSnapshotData["show"]["channels"][number];

interface Props {
  map: AudienceMapData;
  assignments: AssignmentData[];
  channels: ChannelData[];
  drawable: boolean; // true on Assign; false on Review
  onSelection?: (selection: DeviceSelection) => void;
}

const STATUS_COLOR: Record<string, string> = {
  localized: "#71d0b0", coarse: "#f2c76d", ambiguous: "#e08a8a", unseen: "#5a6b86",
};
const W = MAP_CANVAS.width, H = MAP_CANVAS.height;

export function MapPanel({ map, assignments, channels, drawable, onSelection }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [highlight, setHighlight] = useState<number[] | null>(null);
  const [shape, setShape] = useState<"rectangle" | "lasso">("rectangle");
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [deviceFilter, setDeviceFilter] = useState("");
  const drawnMap = useRef(map);

  const channelColor = new Map(channels.map(ch => [ch.channelId, ch.color]));
  const assignedChannel = new Map(assignments.map(a => [a.deviceId, a.channelId]));

  function toMap(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return canvasToMap({ x: e.clientX - rect.left, y: e.clientY - rect.top }, rect);
  }

  // Draw dots + selection. Dots colored by assignment channel if assigned, else by localization status.
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    // stage strip
    ctx.fillStyle = "#6379ba"; ctx.fillRect(300, 0, 300, 18);
    ctx.fillStyle = "#88a9cf"; ctx.font = "11px sans-serif"; ctx.fillText("STAGE", 415, 13);
    const highlightSet = highlight ? new Set(highlight) : null;
    for (const loc of map.locations) {
      if (loc.status !== "localized") continue;
      if (!drawable && (statusFilter !== "all" && loc.status !== statusFilter || deviceFilter.trim() && String(loc.deviceId) !== deviceFilter.trim())) continue;
      const { x: cx, y: cy } = mapToCanvas(loc);
      const ch = assignedChannel.get(loc.deviceId);
      ctx.fillStyle = ch ? channelColor.get(ch) ?? STATUS_COLOR.localized : STATUS_COLOR[loc.status];
      if (highlightSet && highlightSet.has(loc.deviceId)) { ctx.fillStyle = "#ffffff"; }
      ctx.fillRect(cx, cy, 2, 2);
    }
    // selection rectangle overlay
    if (drag && shape === "rectangle") {
      const start = mapToCanvas({ x: drag.x0, y: drag.y0 }), end = mapToCanvas({ x: drag.x1, y: drag.y1 });
      const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
      const w = Math.abs(start.x - end.x), h = Math.abs(start.y - end.y);
      ctx.strokeStyle = "#9db8ff"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    }
    if (points.length > 1 && shape === "lasso") {
      ctx.beginPath(); points.map(mapToCanvas).forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.closePath(); ctx.strokeStyle = "#9db8ff"; ctx.stroke();
    }
  }, [map, assignments, channels, drag, highlight, points, shape, drawable, statusFilter, deviceFilter]);

  function onDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawable) return;
    drawnMap.current = map;
    const p = toMap(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    setPoints([p]);
  }
  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drag) return;
    const p = toMap(e); setDrag({ ...drag, x1: p.x, y1: p.y });
    const polygon = [...points, p]; setPoints(polygon);
    // live preview of selected IDs
    const source = drawnMap.current;
    const sel = shape === "lasso" ? selectDevices(source.locations, polygon, source.mapRevision) : selectRectangle(source.locations, { x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y) }, { x: Math.max(drag.x0, p.x), y: Math.max(drag.y0, p.y) }, source.mapRevision);
    setHighlight(sel.deviceIds);
  }
  function onUp() {
    if (!drag) return;
    const source = drawnMap.current;
    const sel = shape === "lasso" ? selectDevices(source.locations, points, source.mapRevision) : selectRectangle(source.locations, { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1) }, { x: Math.max(drag.x0, drag.x1), y: Math.max(drag.y0, drag.y1) }, source.mapRevision);
    onSelection?.(sel);
    setDrag(null);
  }

  const reviewed = map.locations.filter(loc => (statusFilter === "all" || loc.status === statusFilter)
    && (!deviceFilter.trim() || String(loc.deviceId) === deviceFilter.trim()));
  return (
    <div>
      {drawable && <label>Selection shape <select value={shape} onChange={e => setShape(e.target.value as typeof shape)}><option value="rectangle">Rectangle</option><option value="lasso">Lasso</option></select></label>}
      {!drawable && <div className="controls"><label>Localization status <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
        <option value="all">All phones</option><option value="localized">Accepted positions</option><option value="coarse">Coarse column only</option><option value="ambiguous">Ambiguous</option><option value="unseen">Unseen</option>
      </select></label><label>Device ID <input value={deviceFilter} inputMode="numeric" placeholder="All IDs" onChange={e => setDeviceFilter(e.target.value)} /></label></div>}
      <p className="muted">Stage at top. Audience-left is on the left while facing the stage. Evidence: {map.evidence}. Map revision: {map.mapRevision}.</p>
      <canvas
        ref={canvasRef} width={W} height={H}
        style={{ width: "100%", background: "#101724", borderRadius: 8, cursor: drawable ? "crosshair" : "default", touchAction: "none" }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => setDrag(null)}
        role="img" aria-label="Audience map"
      />
      {highlight && <p className="muted">Selected: {highlight.length} phones</p>}
      {!drawable && <details><summary>{reviewed.length} matching phones — inspect evidence</summary>
        {reviewed.slice(0, 100).map(loc => <p key={loc.deviceId}>Device {loc.deviceId}: {loc.status}, {loc.column ?? "unknown column"}; {loc.mappingMode}; cameras {loc.sourceCameraIds.join(", ") || "none"}.</p>)}
        {reviewed.length > 100 && <p>Showing the first 100 matches. Enter a device ID to inspect another phone.</p>}
      </details>}
    </div>
  );
}
