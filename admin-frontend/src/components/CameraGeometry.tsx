"use client";
import { useEffect, useRef, useState } from "react";
import type { Geometry } from "../lib/adapter";
import { anchorsError, type CameraView } from "../lib/camera-geometry";

const labels = ["front-left", "front-right", "back-right", "back-left"];
export function CameraGeometry({ file, preview, value, disabled, onChange }: {
  file: File | null; preview?: { url: string; rotationDegrees: number }; value: Geometry;
  disabled?: boolean; onChange: (geometry: Geometry) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const still = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState("");
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const savedExclusions = JSON.stringify(value.exclusionRois);
  const [exclusions, setExclusions] = useState(savedExclusions);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setExclusions(savedExclusions); setError(null); }, [savedExclusions]);
  useEffect(() => {
    if (!file) { setUrl(""); return; }
    const source = URL.createObjectURL(file); setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);
  function paint() {
    const source = url ? video.current : still.current, target = canvas.current;
    if (!source || !target) return;
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (!width || !height) return;
    // Review previews have already had the recorded rotation applied.
    const rotation = (value.rotationDegrees - (url ? 0 : preview?.rotationDegrees ?? 0) + 360) % 360;
    const rotated = rotation === 90 || rotation === 270;
    target.width = rotated ? height : width; target.height = rotated ? width : height;
    setDimensions(previous => previous.width === target.width && previous.height === target.height ? previous : { width: target.width, height: target.height });
    const ctx = target.getContext("2d"); if (!ctx) return;
    ctx.save(); ctx.translate(target.width / 2, target.height / 2); ctx.rotate(rotation * Math.PI / 180);
    ctx.drawImage(source, -width / 2, -height / 2); ctx.restore();
    if ((value.anchors?.length ?? 0) > 1) {
      ctx.strokeStyle = "#ffdd00"; ctx.lineWidth = Math.max(2, target.width / 500); ctx.beginPath();
      value.anchors!.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      if (value.anchors?.length === 4) ctx.closePath(); ctx.stroke();
    }
    ctx.font = `bold ${Math.max(16, target.width / 65)}px sans-serif`;
    for (const [index, point] of (value.anchors ?? []).entries()) {
      ctx.fillStyle = "#ffdd00"; ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(5, target.width / 250), 0, Math.PI * 2); ctx.fill();
      const text = `${index + 1} ${labels[index]}`;
      ctx.fillText(text, Math.max(4, Math.min(point.x + 10, target.width - ctx.measureText(text).width - 4)), Math.max(24, point.y - 10));
    }
  }
  useEffect(paint, [value, url, preview?.url]);
  const geometryError = anchorsError(value.anchors, dimensions.width || undefined, dimensions.height || undefined);
  const hasImage = !!url || !!preview?.url;
  return <details><summary>Camera layout — {value.anchors?.length === 4 ? "seating corners" : "automatic approximate positions"}</summary>
    <fieldset disabled={disabled}>
    <p>Each camera maps its audience column independently. One or two recordings work without the missing views.</p>
    <label>Camera faces <select value={value.frameLayout ?? "from-stage"} onChange={e => onChange({ ...value, frameLayout: e.target.value as CameraView, anchors: null })}>
      <option value="from-stage">From the stage toward the audience</option><option value="from-back">From the back toward the stage</option>
    </select></label>
    <p>Map positions are automatic using this camera orientation. For more accurate seating placement, optionally mark four corners below.</p>
    <label>Clockwise rotation <select value={value.rotationDegrees} onChange={e => onChange({ ...value, rotationDegrees: Number(e.target.value) as Geometry["rotationDegrees"], anchors: null })}>
      {[0, 90, 180, 270].map(degrees => <option key={degrees} value={degrees}>{degrees}°</option>)}
    </select></label>
    {url && <video ref={video} src={url} controls preload="auto" muted playsInline onLoadedData={paint} onSeeked={paint} style={{ width: "100%" }} />}
    {!url && preview?.url && <img ref={still} src={preview.url} onLoad={paint} alt="Recorded camera frame for seating calibration" style={{ display: "none" }} />}
    {hasImage ? <>
      <p>For perspective correction, mark the four corners of this column's seating area: front-left, front-right, back-right, back-left, as the audience faces the stage. Include every seat you want to map.</p>
      <p>{value.anchors?.length === 4 ? "Four corners selected. Save geometry and process the recordings." : value.anchors?.length ? `Next corner: ${labels[value.anchors.length]}.` : "Optional: click front-left to start marking seating corners."}</p>
      <canvas ref={canvas} style={{ width: "100%", cursor: "crosshair" }} onClick={event => {
        if (disabled) return;
        const target = event.currentTarget, rect = target.getBoundingClientRect();
        const point = { x: Math.min(target.width - 1, Math.max(0, (event.clientX - rect.left) / rect.width * target.width)), y: Math.min(target.height - 1, Math.max(0, (event.clientY - rect.top) / rect.height * target.height)) };
        onChange({ ...value, anchors: [...(value.anchors?.length === 4 ? [] : value.anchors ?? []), point] });
      }} role="img" aria-label="Mark seating anchors" />
      <p className="muted">The frame preset uses observed image positions, not measured seats. Mark actual seating corners for better front/back placement. From-stage cameras mirror audience-left/right.</p>
    </> : <p>Choose a recording or process the uploaded video to see a preview. Approximate positions work without marking corners.</p>}
    {geometryError && <p role="alert">{geometryError}</p>}
    <button onClick={() => onChange({ ...value, anchors: null, frameLayout: value.frameLayout ?? "from-stage" })}>Use automatic frame layout</button>
    <details><summary>Advanced light/stage exclusions</summary><label>Pixel polygons (JSON)<textarea value={exclusions} onChange={e => {
      setExclusions(e.target.value);
      try { const polygons = JSON.parse(e.target.value); if (!Array.isArray(polygons) || polygons.some((polygon: unknown) => !Array.isArray(polygon) || polygon.length < 3 || polygon.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) throw new Error("Use an array of polygons with at least three {x,y} points each.");
        onChange({ ...value, exclusionRois: polygons }); setError(null);
      } catch (cause) { setError(String(cause)); }
    }} /></label>{error && <p role="alert">{error}</p>}</details>
    </fieldset>
  </details>;
}
