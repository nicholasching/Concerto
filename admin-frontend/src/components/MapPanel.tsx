"use client";
import { useEffect, useRef, useState } from "react";
import type { AdminSnapshotData } from "@orchestra/contracts";
import { selectDevices, selectRectangle, selectRegion } from "@orchestra/selection";
import type { AudienceRegion, DeviceSelection } from "@orchestra/selection";
import { canvasToMap, MAP_CANVAS, mapToCanvas } from "../lib/mapGeometry";

type AssignmentData = AdminSnapshotData["assignments"][number];
type AudienceMapData = AdminSnapshotData["audienceMap"];
type ChannelData = AdminSnapshotData["show"]["channels"][number];

interface Props {
  map: AudienceMapData;
  assignments: AssignmentData[];
  channels: ChannelData[];
  drawable: boolean; // true on Assign; false on Review
  selection?: DeviceSelection | null;
  onSelection?: (selection: DeviceSelection) => void;
}

const STATUS_COLOR: Record<string, string> = {
  localized: "#71d0b0", coarse: "#f2c76d", ambiguous: "#e08a8a", unseen: "#5a6b86",
};
const W = MAP_CANVAS.width, H = MAP_CANVAS.height;

export function MapPanel({ map, assignments, channels, drawable, selection, onSelection }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [highlight, setHighlight] = useState<number[] | null>(null);
  const [shape, setShape] = useState<"rectangle" | "lasso" | "regions">("rectangle");
  const [dividers, setDividers] = useState<[number, number]>([1 / 3, 2 / 3]);
  const [dragDivider, setDragDivider] = useState<number | null>(null);
  const [region, setRegion] = useState<AudienceRegion>("center");
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [deviceFilter, setDeviceFilter] = useState("");
  const drawnMap = useRef(map);

  const channelColor = new Map(channels.map(ch => [ch.channelId, ch.color]));
  const assignedChannel = new Map(assignments.map(a => [a.deviceId, a.channelId]));

  function toMap(e: React.PointerEvent<HTMLCanvasElement>) {
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
    const boundaries = shape === "regions" ? [0, ...dividers, 1] : [0, 1 / 3, 2 / 3, 1];
    ctx.textAlign = "center";
    ["LEFT", "CENTER", "RIGHT"].forEach((label, index) => {
      const start = mapToCanvas({ x: boundaries[index], y: 0 }), end = mapToCanvas({ x: boundaries[index + 1], y: 1 });
      ctx.fillStyle = index % 2 ? "#162238" : "#121c2d";
      ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
      ctx.fillStyle = "#b4c6df"; ctx.fillText(label, (start.x + end.x) / 2, 27);
      if (index < 2) { ctx.strokeStyle = shape === "regions" ? "#b9ccff" : "#34435e"; ctx.lineWidth = shape === "regions" ? 3 : 1;
        ctx.beginPath(); ctx.moveTo(end.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke(); }
    });
    ctx.textAlign = "start";
    const selectedIds = drag ? highlight : selection?.mapRevision === map.mapRevision ? selection.deviceIds : null;
    const highlightSet = new Set(selectedIds ?? []);
    const locatedCount = map.locations.filter(location => location.status === "localized").length;
    for (const loc of map.locations) {
      if (loc.status !== "localized") continue;
      if (!drawable && (statusFilter !== "all" && loc.status !== statusFilter || deviceFilter.trim() && String(loc.deviceId) !== deviceFilter.trim())) continue;
      const { x: cx, y: cy } = mapToCanvas(loc);
      const ch = assignedChannel.get(loc.deviceId);
      ctx.fillStyle = ch ? channelColor.get(ch) ?? STATUS_COLOR.localized : STATUS_COLOR[loc.status];
      const radius = locatedCount <= 80 ? 6 : 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
      if (highlightSet.has(loc.deviceId)) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.stroke(); }
      if (locatedCount <= 80) { ctx.fillStyle = "#e7eef9"; ctx.font = "12px sans-serif"; ctx.fillText(String(loc.deviceId), cx + 9, cy + 4); }
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
  }, [map, assignments, channels, drag, highlight, points, shape, dividers, selection, drawable, statusFilter, deviceFilter]);

  function chooseRegion(next: AudienceRegion, bounds = dividers, source = map) {
    setRegion(next); onSelection?.(selectRegion(source.locations, next, bounds, source.mapRevision));
  }
  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawnMap.current = map;
    const p = toMap(e);
    if (shape === "regions") {
      const line = dividers.findIndex(x => Math.abs(x - p.x) * MAP_CANVAS.widthInner < 12);
      if (line >= 0) setDragDivider(line);
      else chooseRegion(p.x < dividers[0] ? "left" : p.x < dividers[1] ? "center" : "right");
      return;
    }
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    setPoints([p]);
  }
  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dragDivider !== null) {
      const bounds: [number, number] = [...dividers];
      bounds[dragDivider] = Math.max(dragDivider === 0 ? 0.01 : bounds[0] + 0.01, Math.min(dragDivider === 0 ? bounds[1] - 0.01 : 0.99, toMap(e).x));
      setDividers(bounds); chooseRegion(region, bounds, drawnMap.current); return;
    }
    if (!drag) return;
    const p = toMap(e); setDrag({ ...drag, x1: p.x, y1: p.y });
    const polygon = [...points, p]; setPoints(polygon);
    // live preview of selected IDs
    const source = drawnMap.current;
    const sel = shape === "lasso" ? selectDevices(source.locations, polygon, source.mapRevision) : selectRectangle(source.locations, { x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y) }, { x: Math.max(drag.x0, p.x), y: Math.max(drag.y0, p.y) }, source.mapRevision);
    setHighlight(sel.deviceIds);
  }
  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragDivider(null);
    if (!drag) return;
    const source = drawnMap.current;
    const end = toMap(e);
    let sel: DeviceSelection;
    if (Math.hypot((end.x - drag.x0) * MAP_CANVAS.widthInner, (end.y - drag.y0) * MAP_CANVAS.heightInner) < 4) {
      const closest = source.locations.filter(location => location.status === "localized").map(location => ({ id: location.deviceId,
        distance: Math.hypot((location.x! - end.x) * MAP_CANVAS.widthInner, (location.y! - end.y) * MAP_CANVAS.heightInner) })).sort((a, b) => a.distance - b.distance)[0];
      sel = { mapRevision: source.mapRevision, deviceIds: closest && closest.distance <= 12 ? [closest.id] : [] };
    } else sel = shape === "lasso" ? selectDevices(source.locations, [...points, end], source.mapRevision)
      : selectRectangle(source.locations, { x: drag.x0, y: drag.y0 }, end, source.mapRevision);
    onSelection?.(sel);
    setDrag(null);
  }

  const reviewed = map.locations.filter(loc => (statusFilter === "all" || loc.status === statusFilter)
    && (!deviceFilter.trim() || String(loc.deviceId) === deviceFilter.trim()));
  return (
    <div>
      {drawable && <label>Selection shape <select value={shape} onChange={e => { setShape(e.target.value as typeof shape); setDrag(null); setPoints([]); }}><option value="rectangle">Rectangle</option><option value="lasso">Lasso</option><option value="regions">Left / center / right dividers</option></select></label>}
      {drawable && shape === "regions" && <div className="controls"><p>Drag the two vertical lines to define groups, then select a region. These groups can be assigned to any musical channel.</p>
        {(["left", "center", "right"] as const).map(value => <button key={value} onClick={() => chooseRegion(value)}>Select {value} region</button>)}
        <button onClick={() => { const thirds: [number, number] = [1 / 3, 2 / 3]; setDividers(thirds); chooseRegion(region, thirds); }}>Reset dividers</button>
      </div>}
      {!drawable && <div className="controls"><label>Localization status <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
        <option value="all">All phones</option><option value="localized">Accepted positions</option><option value="coarse">Coarse column only</option><option value="ambiguous">Ambiguous</option><option value="unseen">Unseen</option>
      </select></label><label>Device ID <input value={deviceFilter} inputMode="numeric" placeholder="All IDs" onChange={e => setDeviceFilter(e.target.value)} /></label></div>}
      <p className="muted">Stage at top. Audience-left is on the left while facing the stage. Evidence: {map.evidence}. Map revision: {map.mapRevision}.</p>
      <p>{map.locations.filter(location => location.status === "localized").length} devices with map positions. {drawable && "Click a device, draw a box/lasso, or use the region dividers."}</p>
      {map.locations.some(location => location.status === "localized") && <p className="muted">Positions estimate the audience layout from camera images. Verify front/back placement against known seats before the performance.</p>}
      {!map.locations.some(location => location.status === "localized") && <p role="status">No map positions yet. Process recordings in Calibration and commit the reviewed map to enable spatial selection. Approximate frame positions are automatic; seating corners are optional.</p>}
      <canvas
        ref={canvasRef} width={W} height={H}
        style={{ width: "100%", background: "#101724", borderRadius: 8, cursor: drawable ? "crosshair" : "default", touchAction: "none" }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { setDrag(null); setDragDivider(null); }}
        role="img" aria-label="Audience map"
      />
      {selection && <p className="muted">Selected: {selection.deviceIds.length} phones</p>}
      {reviewed.some(location => location.status === "coarse") && <div><h3>Column-only devices, row positions unavailable</h3>
        <div className="controls">{(["left", "center", "right"] as const).map(column => {
          const devices = reviewed.filter(location => location.status === "coarse" && location.column === column);
          return <div key={column}><strong>{column}: {devices.length}</strong><p>{devices.slice(0, 80).map(location => drawable
            ? <button key={location.deviceId} onClick={() => onSelection?.({ mapRevision: map.mapRevision, deviceIds: [location.deviceId] })}>Device {location.deviceId}</button>
            : <span key={location.deviceId}> Device {location.deviceId} </span>)}</p></div>;
        })}</div>
      </div>}
      {!drawable && <details><summary>{reviewed.length} matching phones, inspect evidence</summary>
        {reviewed.slice(0, 100).map(loc => <p key={loc.deviceId}>Device {loc.deviceId}: {loc.status}, {loc.column ?? "unknown column"}; {loc.mappingMode}; cameras {loc.sourceCameraIds.join(", ") || "none"}.</p>)}
        {reviewed.length > 100 && <p>Showing the first 100 matches. Enter a device ID to inspect another phone.</p>}
      </details>}
    </div>
  );
}
