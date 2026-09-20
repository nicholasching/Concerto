"use client";
import { useEffect, useRef, useState } from "react";
import { AUDIENCE_SECTIONS, splitAudience, type AdminSnapshotData } from "@orchestra/contracts";
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
  automaticSections?: boolean;
  selection?: DeviceSelection | null;
  onSelection?: (selection: DeviceSelection) => void;
}

const STATUS_COLOR: Record<string, string> = {
  localized: "#71d0b0", coarse: "#f2c76d", ambiguous: "#e08a8a", unseen: "#5a6b86",
};
const W = MAP_CANVAS.width, H = MAP_CANVAS.height;

export function MapPanel({ map, assignments, channels, drawable, selection, onSelection, automaticSections = false }: Props) {
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
  const [rasterScale, setRasterScale] = useState(1);

  // Keep map coordinates stable while rendering sharply at the actual display size.
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => setRasterScale(Math.max(1, canvas.getBoundingClientRect().width / W * Math.min(window.devicePixelRatio || 1, 2)));
    const observer = new ResizeObserver(resize);
    observer.observe(canvas); window.addEventListener("resize", resize); resize();
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, []);

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
    canvas.width = Math.round(W * rasterScale); canvas.height = Math.round(H * rasterScale);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // A fine stage line shares the surrounding silver surface.
    ctx.strokeStyle = "#90969e"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(335, 12); ctx.lineTo(410, 12); ctx.moveTo(490, 12); ctx.lineTo(565, 12); ctx.stroke();
    ctx.fillStyle = "#555c65"; ctx.font = "10px Arial, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("STAGE", W / 2, 15);
    const groups = splitAudience(map.locations);
    const boundaries = automaticSections ? [0, ...groups.map(group => group.endX)] : shape === "regions" ? [0, ...dividers, 1] : [0, 1 / 3, 2 / 3, 1];
    const memberColors = new Map((map.sections ?? []).map(member => [member.deviceId, AUDIENCE_SECTIONS.find(section => section.id === member.section)!.color]));
    // No filled section blocks: boundaries indicate grouping without suggesting equal widths.
    boundaries.slice(1, -1).forEach(boundary => {
      const start = mapToCanvas({ x: boundary, y: 0 }), end = mapToCanvas({ x: boundary, y: 1 });
      ctx.strokeStyle = shape === "regions" && !automaticSections ? "#66727e" : "#9ba1a855";
      ctx.lineWidth = shape === "regions" && !automaticSections ? 1.5 : 0.75;
      ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke(); ctx.setLineDash([]);
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
      ctx.fillStyle = automaticSections ? memberColors.get(loc.deviceId) ?? STATUS_COLOR.localized : ch ? channelColor.get(ch) ?? STATUS_COLOR.localized : STATUS_COLOR[loc.status];
      const radius = locatedCount <= 80 ? 4.5 : 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#343a424d"; ctx.lineWidth = 0.75; ctx.stroke();
      if (highlightSet.has(loc.deviceId)) { ctx.beginPath(); ctx.arc(cx, cy, radius + 2.5, 0, Math.PI * 2); ctx.strokeStyle = "#283e50"; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (locatedCount <= 80) { ctx.fillStyle = "#343a42"; ctx.font = "10px Arial, sans-serif"; ctx.fillText(String(loc.deviceId), cx + 8, cy + 3); }
    }
    // selection rectangle overlay
    if (drag && shape === "rectangle") {
      const start = mapToCanvas({ x: drag.x0, y: drag.y0 }), end = mapToCanvas({ x: drag.x1, y: drag.y1 });
      const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
      const w = Math.abs(start.x - end.x), h = Math.abs(start.y - end.y);
      ctx.strokeStyle = "#435a70"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    }
    if (points.length > 1 && shape === "lasso") {
      ctx.beginPath(); points.map(mapToCanvas).forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.closePath(); ctx.strokeStyle = "#435a70"; ctx.stroke();
    }
  }, [map, assignments, channels, drag, highlight, points, shape, dividers, selection, drawable, statusFilter, deviceFilter, automaticSections, rasterScale]);

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
    <div className="map-panel">
      {drawable && <label>Selection shape <select value={shape} onChange={e => { setShape(e.target.value as typeof shape); setDrag(null); setPoints([]); }}><option value="rectangle">Rectangle</option><option value="lasso">Lasso</option><option value="regions">Left / center / right dividers</option></select></label>}
      {drawable && shape === "regions" && <div className="controls"><p>Drag the two vertical lines to define groups, then select a region. These groups can be assigned to any musical channel.</p>
        {(["left", "center", "right"] as const).map(value => <button key={value} onClick={() => chooseRegion(value)}>Select {value} region</button>)}
        <button onClick={() => { const thirds: [number, number] = [1 / 3, 2 / 3]; setDividers(thirds); chooseRegion(region, thirds); }}>Reset dividers</button>
      </div>}
      {!drawable && <div className="map-toolbar"><label>Status <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
        <option value="all">All phones</option><option value="localized">Accepted positions</option><option value="coarse">Coarse column only</option><option value="ambiguous">Ambiguous</option><option value="unseen">Unseen</option>
      </select></label><label>Device ID <input value={deviceFilter} inputMode="numeric" placeholder="All IDs" onChange={e => setDeviceFilter(e.target.value)} /></label></div>}
      <div className="map-caption"><span>{map.locations.filter(location => location.status === "localized").length} located · {map.evidence}</span><span>Facing the stage</span></div>
      {drawable && <p className="muted">Click or drag to select phones.</p>}
      {!map.locations.some(location => location.status === "localized") && <p className="map-empty" role="status">No positions yet. Process and review a calibration to populate the map.</p>}
      <canvas
        className="map-canvas" ref={canvasRef} width={W} height={H}
        style={{ cursor: drawable ? "crosshair" : "default", touchAction: drawable ? "none" : "pan-y" }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { setDrag(null); setDragDivider(null); }}
        role="img" aria-label="Audience map"
      />
      <div className="map-caption"><span>Audience left</span><span>Audience right</span></div>
      {selection && <p className="muted">Selected: {selection.deviceIds.length} phones</p>}
      {!automaticSections && reviewed.some(location => location.status === "coarse") && <div><h3>Column-only devices — row positions unavailable</h3>
        <div className="controls">{(["left", "center", "right"] as const).map(column => {
          const devices = reviewed.filter(location => location.status === "coarse" && location.column === column);
          return <div key={column}><strong>{column}: {devices.length}</strong><p>{devices.slice(0, 80).map(location => drawable
            ? <button key={location.deviceId} onClick={() => onSelection?.({ mapRevision: map.mapRevision, deviceIds: [location.deviceId] })}>Device {location.deviceId}</button>
            : <span key={location.deviceId}> Device {location.deviceId} </span>)}</p></div>;
        })}</div>
      </div>}
      <details className="map-notes"><summary>Map details{!drawable && ` · ${reviewed.length} phones`}</summary>
        <p className="muted">Revision {map.mapRevision} · {map.evidence} evidence. Positions are approximate; verify front/back against known seats. Left and right are from the audience facing the stage.{automaticSections && " Colors indicate balanced sections; boundaries follow phone counts, not equal widths."}</p>
      {!drawable && <>
        {reviewed.slice(0, 100).map(loc => <p key={loc.deviceId}>Device {loc.deviceId}: {loc.status}, {loc.column ?? "unknown column"}; {loc.mappingMode}; cameras {loc.sourceCameraIds.join(", ") || "none"}.</p>)}
        {reviewed.length > 100 && <p>Showing the first 100 matches. Enter a device ID to inspect another phone.</p>}
      </>}
      </details>
    </div>
  );
}
