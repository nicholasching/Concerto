"use client";
import { useEffect, useRef, useState } from "react";
import type { Geometry } from "../lib/adapter";

const labels = ["front-left", "front-right", "back-right", "back-left"];
export function CameraGeometry({ file, value, onChange }: { file: File | null; value: Geometry; onChange: (geometry: Geometry) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState("");
  const [exclusions, setExclusions] = useState("[]");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setUrl(""); return; }
    const source = URL.createObjectURL(file); setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);
  function paint() {
    const source = video.current, target = canvas.current;
    if (!source || !target || !source.videoWidth) return;
    const rotated = value.rotationDegrees === 90 || value.rotationDegrees === 270;
    target.width = rotated ? source.videoHeight : source.videoWidth;
    target.height = rotated ? source.videoWidth : source.videoHeight;
    const ctx = target.getContext("2d"); if (!ctx) return;
    ctx.save(); ctx.translate(target.width / 2, target.height / 2); ctx.rotate(value.rotationDegrees * Math.PI / 180);
    ctx.drawImage(source, -source.videoWidth / 2, -source.videoHeight / 2); ctx.restore();
    ctx.font = `${Math.max(14, target.width / 80)}px sans-serif`;
    for (const [index, point] of (value.anchors ?? []).entries()) {
      ctx.fillStyle = "#ffdd00"; ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(5, target.width / 250), 0, Math.PI * 2); ctx.fill();
      ctx.fillText(`${index + 1} ${labels[index]}`, point.x + 10, point.y);
    }
  }
  useEffect(paint, [value]);
  return <details><summary>Camera orientation and seating anchors</summary>
    <label>Clockwise rotation <select value={value.rotationDegrees} onChange={e => onChange({ ...value, rotationDegrees: Number(e.target.value) as Geometry["rotationDegrees"], anchors: null })}>
      {[0, 90, 180, 270].map(degrees => <option key={degrees} value={degrees}>{degrees}°</option>)}
    </select></label>
    {url && <><video ref={video} src={url} controls preload="auto" muted playsInline onLoadedData={paint} onSeeked={paint} style={{ width: "100%" }} />
      <p>Pause on a clear frame. Click the seating corners in audience order: front-left, front-right, back-right, back-left.</p>
      <canvas ref={canvas} style={{ width: "100%", cursor: "crosshair" }} onClick={event => {
        const target = event.currentTarget, rect = target.getBoundingClientRect();
        const point = { x: (event.clientX - rect.left) / rect.width * target.width, y: (event.clientY - rect.top) / rect.height * target.height };
        onChange({ ...value, anchors: [...(value.anchors?.length === 4 ? [] : value.anchors ?? []), point] });
      }} aria-label="Mark seating anchors" /></>}
    <p>{value.anchors?.length ?? 0}/4 anchors. Without all four anchors, row positions may remain unknown.</p>
    <button onClick={() => onChange({ ...value, anchors: null })}>Clear anchors</button>
    <label>Exclude stage or lights (pixel polygons, JSON)<textarea value={exclusions} onChange={e => {
      setExclusions(e.target.value);
      try { const polygons = JSON.parse(e.target.value); if (!Array.isArray(polygons) || polygons.some((polygon: unknown) => !Array.isArray(polygon) || polygon.length < 3 || polygon.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) throw new Error("Use an array of polygons with at least three {x,y} points each.");
        onChange({ ...value, exclusionRois: polygons }); setError(null);
      } catch (cause) { setError(String(cause)); }
    }} /></label>{error && <p role="alert">{error}</p>}
  </details>;
}
