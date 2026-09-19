"use client";
import { useRef, useState } from "react";
import { useAdapter } from "../lib/useSnapshot";
import type { Column } from "../lib/adapter";

interface Slot { index: number; cameraId: string; column: Column; status: "idle" | "uploading" | "done" | "error"; uploadId: string | null; file: File | null; error?: string; }

const COLUMNS: Column[] = ["left", "center", "right"];

export function CalibrationPanel({ refresh, mapRevision }: { refresh: () => void; mapRevision: number }) {
  const adapter = useAdapter();
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [runTag, setRunTag] = useState<number | null>(null);
  const [slots, setSlots] = useState<Slot[]>([
    { index: 0, cameraId: "cam-left", column: "left", status: "idle", uploadId: null, file: null },
    { index: 1, cameraId: "cam-center", column: "center", status: "idle", uploadId: null, file: null },
    { index: 2, cameraId: "cam-right", column: "right", status: "idle", uploadId: null, file: null },
  ]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage: string; progress: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startRun() {
    setError(null);
    try {
      const participantIds = Array.from({ length: 30 }, (_, i) => i); // demo subset
      const palette = { zero: "#0000ff", one: "#ff0000", neutral: "#000000" };
      const result = await adapter.createCalibration(participantIds, palette, "palette-v1");
      setRunId(result.runId); setRunTag(result.runTag);
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  }

  async function upload(slotIndex: number) {
    if (!runId) return;
    setError(null);
    setSlots(prev => prev.map(s => s.index === slotIndex ? { ...s, status: "uploading" } : s));
    try {
      const slot = slots[slotIndex];
      // Sends the chosen video file to the real server. If no file is chosen, it still attempts the
      // real call; if the server isn't running, the catch below shows "Real server not detected".
      const result = await adapter.uploadCamera(runId, slot.cameraId, slot.column, slot.file);
      setSlots(prev => prev.map(s => s.index === slotIndex ? { ...s, status: "done", uploadId: result.uploadId } : s));
    } catch (e) {
      // A failed upload marks only this slot; the other two keep their state.
      setSlots(prev => prev.map(s => s.index === slotIndex ? { ...s, status: "error", error: String(e instanceof Error ? e.message : e) } : s));
    }
  }

  async function process() {
    if (!runId) return;
    const uploadIds = slots.filter(s => s.uploadId).map(s => s.uploadId!);
    if (uploadIds.length === 0) return;
    setError(null);
    try {
      const result = await adapter.createJob(runId, uploadIds);
      setJobId(result.jobId); setProgress({ stage: "queued", progress: 0, message: "Queued" });
      pollJob(result.jobId);
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  }

  async function pollJob(id: string) {
    const poll = async () => {
      try {
        const p = await adapter.getJobProgress(id);
        setProgress({ stage: p.stage, progress: p.progress, message: p.message });
        if (p.stage !== "complete" && p.stage !== "failed" && p.stage !== "cancelled") setTimeout(poll, 200);
      } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    };
    setTimeout(poll, 200);
  }

  async function commit() {
    if (!runId || !jobId) return;
    setError(null);
    try {
      await adapter.commitMap(runId, jobId, mapRevision);
      refresh();
      setRunId(null); setRunTag(null); setJobId(null); setProgress(null);
      setSlots(prev => prev.map(s => ({ ...s, status: "idle", uploadId: null, file: null, error: undefined })));
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  }

  const doneCount = slots.filter(s => s.status === "done").length;
  const canProcess = runId !== null && doneCount > 0 && !jobId;
  const canCommit = progress?.stage === "complete";

  return (
    <section>
      <h2>Calibration</h2>
      <p className="muted">A short flashing test figures out where each phone is. Each camera slot takes a video recording of the phones flashing. If the real server isn't running, every action below retries it and shows "Real server not detected". One failed upload does not discard the others.</p>
      {error && <p role="alert" className="error">Error: {error}</p>}
      {!runId && <button onClick={startRun}>Start calibration run</button>}
      {runId && <>
        <p>Run <code>{runId}</code> (tag {runTag}). Map revision before commit: {mapRevision}.</p>
        <div className="slots">
          {slots.map(slot => (
            <div key={slot.index} className={`slot slot-${slot.status}`}>
              <h3>Camera {slot.index + 1} — {slot.column}</h3>
              <label>Column
                <select value={slot.column} onChange={e => setSlots(prev => prev.map(s => s.index === slot.index ? { ...s, column: e.target.value as Column } : s))}>
                  {COLUMNS.map(col => <option key={col} value={col}>{col}</option>)}
                </select>
              </label>
              <input
                ref={el => { fileRefs.current[slot.index] = el; }}
                type="file" accept="video/*" aria-label={`Camera ${slot.index + 1} video`}
                onChange={e => setSlots(prev => prev.map(s => s.index === slot.index ? { ...s, file: e.target.files?.[0] ?? null } : s))}
              />
              <button disabled={slot.status === "uploading"} onClick={() => upload(slot.index)}>
                {slot.status === "uploading" ? "Uploading..." : slot.status === "done" ? "Re-upload" : "Upload camera video"}
              </button>
              <p className="muted">Status: {slot.status}{slot.file ? ` — ${slot.file.name}` : ""}{slot.error ? ` — ${slot.error}` : ""}</p>
            </div>
          ))}
        </div>
        <div className="actions">
          <button disabled={!canProcess} onClick={process}>Process{doneCount > 0 ? ` (${doneCount} upload${doneCount === 1 ? "" : "s"})` : ""}</button>
          {jobId && progress && (
            <div className="progress">
              <p>Job <code>{jobId}</code> — {progress.stage}: {Math.round(progress.progress * 100)}% — {progress.message}</p>
              <div className="bar"><div style={{ width: `${progress.progress * 100}%` }} /></div>
            </div>
          )}
          {canCommit && <button onClick={commit}>Commit map</button>}
        </div>
      </>}
    </section>
  );
}
