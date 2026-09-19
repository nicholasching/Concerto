"use client";
import { useEffect, useState } from "react";
import { useAdapter } from "../lib/useSnapshot";
import { clockReady, futureServerMs, nowServerMs } from "../lib/clock";
import type { Column, Geometry } from "../lib/adapter";
import type { AdminSnapshotData, OtcResultData } from "@orchestra/contracts";
import { MapPanel } from "./MapPanel";
import { CameraGeometry } from "./CameraGeometry";
import { jobMessage } from "../lib/job-message";

interface Slot { cameraId: string; column: Column; file: File | null; geometry: Geometry; progress: number; busy: boolean; error: string | null }
const columns: Column[] = ["left", "center", "right"];
export function CalibrationPanel({ refresh, snapshot }: { refresh: () => void; snapshot: AdminSnapshotData | null }) {
  const adapter = useAdapter();
  const run = snapshot?.calibration;
  const runId = run?.plan.runId;
  const [slots, setSlots] = useState<Slot[]>(() => columns.map(column => ({ cameraId: `camera-${column}`, column, file: null,
    geometry: { rotationDegrees: 0, anchors: null, exclusionRois: [] }, progress: 0, busy: false, error: null })));
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage: string; progress: number; message: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [candidate, setCandidate] = useState<OtcResultData | null>(null);
  const [candidateRevision, setCandidateRevision] = useState(0);
  const [evidence, setEvidence] = useState<"physical" | "synthetic">("physical");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [targetIds, setTargetIds] = useState("");
  const [checked, setChecked] = useState(false);
  const [tick, setTick] = useState(0);
  const [previews, setPreviews] = useState<string[]>([]);
  const barrier = snapshot?.preparations.find(item => item.domain === "calibration" && item.preparationId === run?.preparationId);
  useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), 250); return () => clearInterval(timer); }, []);
  useEffect(() => {
    setCandidate(null); setProgress(null); setDiagnostics([]); setChecked(false); setJobId(null);
    if (runId) { try { setJobId(sessionStorage.getItem(`orchestra:job:${runId}`)); } catch { /* no storage */ } }
  }, [runId]);
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await adapter.getJobProgress(jobId);
        if (cancelled) return;
        setProgress({ ...job.progress, message: jobMessage(job.progress, job.diagnostics) });
        setDiagnostics(job.diagnostics);
        if (job.result) { setCandidate(job.result); setCandidateRevision(snapshot?.audienceMap.mapRevision ?? 0); }
        else if (!["failed", "cancelled"].includes(job.progress.stage)) timer = setTimeout(poll, 500);
      } catch (cause) { if (!cancelled) setError(String(cause)); }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId]);
  useEffect(() => {
    if (!candidate || !jobId) { setPreviews([]); return; }
    let cancelled = false; const urls: string[] = [];
    void Promise.all(candidate.cameras.map(async (_, index) => {
      try { const blob = await adapter.preview(jobId, index); const url = URL.createObjectURL(blob); urls[index] = url; }
      catch { urls[index] = ""; }
    })).then(() => { if (!cancelled) setPreviews([...urls]); else urls.forEach(url => url && URL.revokeObjectURL(url)); });
    return () => { cancelled = true; urls.forEach(url => url && URL.revokeObjectURL(url)); };
  }, [candidate, jobId]);
  async function act(work: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await work(); refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function prepare() {
    if (!snapshot) throw new Error("Connect as operator first.");
    const readyIds = snapshot.devices.filter(device => device.connected && device.foreground && device.clockReady).map(device => device.deviceId);
    const requested = targetIds.trim() ? [...new Set(targetIds.split(/[\s,]+/).map(Number))] : readyIds;
    if (requested.some(id => !Number.isInteger(id) || !readyIds.includes(id))) throw new Error("Each target ID must name a connected, visible phone with a synchronized clock.");
    const ids = requested;
    if (!ids.length) throw new Error("No connected, visible phones have synchronized yet.");
    await adapter.createCalibration(ids, { zero: "#FFB000", one: "#0066FF", neutral: "#111111" }, "amber-blue-v1");
  }
  async function upload(index: number) {
    if (!runId) return;
    const slot = slots[index];
    const update = (patch: Partial<Slot>) => setSlots(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));
    update({ busy: true, error: null, progress: 0 });
    try {
      if (slot.geometry.anchors && slot.geometry.anchors.length !== 4) throw new Error("Mark all four anchors or clear them for a coarse map.");
      await adapter.uploadCamera(runId, slot.cameraId, slot.column, slot.file, slot.geometry, fraction => update({ progress: fraction }));
      update({ progress: 1 }); refresh();
    } catch (cause) { update({ error: cause instanceof Error ? cause.message : String(cause) }); }
    finally { update({ busy: false }); }
  }
  async function processClips() {
    if (!run) return;
    const job = await adapter.createJob(run.plan.runId, run.uploads.map(upload => upload.uploadId), evidence);
    setJobId(job.jobId); setProgress(job); setDiagnostics([]); setCandidate(null); setChecked(false);
    try { sessionStorage.setItem(`orchestra:job:${run.plan.runId}`, job.jobId); } catch { /* page-only */ }
  }
  const activeJob = progress && !["complete", "failed", "cancelled"].includes(progress.stage);
  const now = tick >= 0 && clockReady() ? nowServerMs() : null;
  const finishedCapture = run?.startServerMs !== null && run?.startServerMs !== undefined && now !== null && now >= run.startServerMs + 11000;
  return <section>
    <h2>Calibration and map review</h2>
    <p>Record three fixed cameras with a few seconds of margin. Use original files. The phone pattern lasts 11 seconds; participants may skip and choose a column.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!run && <><label>Target device IDs (optional, comma separated) <input value={targetIds} placeholder="All ready phones" onChange={event => setTargetIds(event.target.value)} /></label><button disabled={busy || !snapshot} onClick={() => void act(prepare)}>Prepare calibration</button></>}
    {run && <>
      <p>Run tag {run.plan.runTag} · {run.status} · {run.plan.participantIds.length} participating phones</p>
      {run.reports.length > 0 && <p>{run.reports.filter(report => report.completed).length} phones finished; {run.reports.filter(report => !report.completed).length} interrupted.</p>}
      {run.reports.filter(report => !report.completed).map(report => <p key={report.deviceId}>Device {report.deviceId}: {report.reason ?? "pattern interrupted"}</p>)}
      {barrier && <p>{barrier.readyIds.length}/{barrier.expectedIds.length} ready; {barrier.excluded.length} excluded; {barrier.expectedIds.length - barrier.readyIds.length - barrier.excluded.length} pending.</p>}
      {barrier?.excluded.map(item => <p key={item.deviceId}>Device {item.deviceId}: {item.reason}</p>)}
      {run.status === "created" && <button disabled={busy || !barrier?.readyIds.length || !clockReady()} onClick={() => void act(() => adapter.armCalibration(run.plan.runId, run.preparationId, futureServerMs(4)))}>Cameras recording — arm ready phones</button>}
      {run.startServerMs !== null && now !== null && <p role="status">{now < run.startServerMs ? `Starts in ${((run.startServerMs - now) / 1000).toFixed(1)} s` : !finishedCapture ? `Pattern running · ${Math.max(0, (run.startServerMs + 11000 - now) / 1000).toFixed(1)} s remaining` : "Pattern finished. Stop recordings after the trailing margin, then upload."}</p>}
      <button disabled={busy || !!activeJob} onClick={() => void act(() => adapter.discardCalibration(run.plan.runId))}>Discard run and retry</button>
      <div className="slots">{slots.map((slot, index) => {
        const uploaded = run.uploads.find(upload => upload.cameraId === slot.cameraId);
        return <div className="slot" key={slot.cameraId}><h3>Camera {index + 1}</h3>
          <label>Audience column <select value={slot.column} disabled={!!activeJob} onChange={e => setSlots(current => current.map((item, i) => i === index ? { ...item, column: e.target.value as Column } : item))}>{columns.map(column => <option key={column}>{column}</option>)}</select></label>
          <input type="file" accept="video/*" aria-label={`Camera ${index + 1} video`} disabled={!!activeJob} onChange={e => setSlots(current => current.map((item, i) => i === index ? { ...item, file: e.target.files?.[0] ?? null } : item))} />
          <CameraGeometry file={slot.file} value={slot.geometry} onChange={geometry => setSlots(current => current.map((item, i) => i === index ? { ...item, geometry } : item))} />
          <button disabled={!slot.file || slot.busy || !!uploaded || !finishedCapture} onClick={() => void upload(index)}>{uploaded ? "Uploaded and hashed" : slot.busy ? `Uploading ${Math.round(slot.progress * 100)}%` : "Upload recording"}</button>
          {uploaded && <p>{uploaded.label} · {(uploaded.byteSize / 1e6).toFixed(1)} MB · {uploaded.anchors ? "four anchors" : "coarse geometry"}</p>}
          {uploaded && <button disabled={busy || !!activeJob} onClick={() => void act(async () => {
            await adapter.updateCamera(run.plan.runId, uploaded.uploadId, slot.column, slot.geometry);
            setCandidate(null); setChecked(false); setJobId(null); setProgress(null);
            sessionStorage.removeItem(`orchestra:job:${run.plan.runId}`);
          })}>Save corrected geometry — process again</button>}
          {slot.error && <p role="alert">{slot.error}</p>}
        </div>;
      })}</div>
      <label>Recording source <select value={evidence} onChange={e => setEvidence(e.target.value as typeof evidence)}><option value="physical">Actual camera recordings</option><option value="synthetic">Generated test clips (synthetic)</option></select></label>
      <button disabled={busy || !run.uploads.length || !!activeJob} onClick={() => void act(processClips)}>{progress?.stage === "failed" || progress?.stage === "cancelled" ? "Retry processing" : "Process uploaded recordings"}</button>
      {progress && <p role="status">{progress.stage} · {Math.round(progress.progress * 100)}% · {progress.message}</p>}
      {progress?.stage === "failed" && diagnostics.length > 0 && <details><summary>Processing diagnostics</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{diagnostics.join("\n")}</pre></details>}
      {activeJob && jobId && <button onClick={() => void act(() => adapter.cancelJob(jobId))}>Cancel processing</button>}
      {candidate && snapshot && <div><h3>Candidate map — awaiting your review</h3>
        <p>Evidence: {candidate.evidence}. {candidate.locations.filter(location => location.status === "localized").length} localized of {run.plan.participantIds.length}. Processing {(candidate.processingMs / 1000).toFixed(1)} s.</p>
        <MapPanel map={{ mapRevision: candidateRevision, runId: candidate.runId, evidence: candidate.evidence, locations: candidate.locations }} assignments={[]} channels={snapshot.show.channels} drawable={false} />
        {candidate.cameras.map((camera, index) => <details key={camera.cameraId}><summary>{camera.cameraId}: {camera.acceptedTracks} accepted / {camera.rejectedTracks} rejected</summary>
          {previews[index] && <img src={previews[index]} alt={`Decoded tracks for ${camera.cameraId}`} style={{ width: "100%" }} />}
          {camera.messages.map((message, i) => <p key={i}>{message}</p>)}
        </details>)}
        <details><summary>Unresolved phones and rejected observations</summary>
          {candidate.locations.filter(location => location.status !== "localized").map(location => <p key={location.deviceId}>Device {location.deviceId}: {location.status}, {location.column ?? "unknown column"}, {location.mappingMode}</p>)}
          {candidate.observations.filter(observation => observation.status !== "accepted").map((observation, index) => <p key={index}>{observation.cameraId}/{observation.trackId}: {observation.reasons.join(", ")}</p>)}
        </details>
        {candidate.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
        <label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> I checked camera orientation, known seats, and the unresolved list.</label>
        <button disabled={!checked || busy || candidateRevision !== snapshot.audienceMap.mapRevision} onClick={() => void act(async () => {
          await adapter.commitMap(run.plan.runId, jobId!, candidateRevision); setCandidate(null); setJobId(null);
        })}>Commit reviewed map</button>
        {candidateRevision !== snapshot.audienceMap.mapRevision && <p>The map changed during review. Process again against the current map before committing.</p>}
      </div>}
    </>}
  </section>;
}
