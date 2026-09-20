"use client";
import { calibrationDurationMs } from "@orchestra/contracts/otc";
import { useEffect, useState } from "react";
import { useAdapter } from "../lib/useSnapshot";
import { clockReady, futureServerMs, nowServerMs } from "../lib/clock";
import type { Column, Geometry } from "../lib/adapter";
import { DEFAULT_CALIBRATION_PALETTE, type AdminSnapshotData, type OtcResultData } from "@orchestra/contracts";
import { MapPanel } from "./MapPanel";
import { CameraGeometry } from "./CameraGeometry";
import { jobMessage } from "../lib/job-message";
import { anchorsError, cameraGeometry, sameGeometry, usesFrameAnchors } from "../lib/camera-geometry";

interface Slot { cameraId: string; column: Column | null; file: File | null; geometry: Geometry | null; progress: number; busy: boolean; error: string | null }
const columns: Column[] = ["left", "center", "right"];
const emptySlots = (): Slot[] => columns.map(column => ({ cameraId: `camera-${column}`, column: null, file: null,
  geometry: null, progress: 0, busy: false, error: null }));
export function CalibrationPanel({ refresh, snapshot }: { refresh: () => void; snapshot: AdminSnapshotData | null }) {
  const adapter = useAdapter();
  const run = snapshot?.calibration;
  const runId = run?.plan.runId;
  const [slots, setSlots] = useState<Slot[]>(emptySlots);
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
  const [excludedUploads, setExcludedUploads] = useState<string[]>([]);
  const selectedUploads = run?.uploads.filter(upload => !excludedUploads.includes(upload.uploadId)) ?? [];
  const repeatedRecording = new Set(selectedUploads.map(upload => upload.sha256)).size !== selectedUploads.length;
  const decodedCount = new Set(candidate?.observations.filter(item => item.status === "accepted" && item.deviceId !== null).map(item => item.deviceId)).size;
  const barrier = snapshot?.preparations.find(item => item.domain === "calibration" && item.preparationId === run?.preparationId);
  useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), 250); return () => clearInterval(timer); }, []);
  useEffect(() => {
    setSlots(emptySlots());
    setCandidate(null); setProgress(null); setDiagnostics([]); setChecked(false); setJobId(null); setExcludedUploads([]);
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
    await adapter.createCalibration(ids, DEFAULT_CALIBRATION_PALETTE.palette, DEFAULT_CALIBRATION_PALETTE.paletteVersion);
  }
  async function upload(index: number) {
    if (!runId) return;
    const slot = resolvedSlot(index);
    const update = (patch: Partial<Slot>) => setSlots(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));
    update({ busy: true, error: null, progress: 0 });
    try {
      const invalid = anchorsError(slot.geometry.anchors); if (invalid) throw new Error(invalid);
      await adapter.uploadCamera(runId, slot.cameraId, slot.column, slot.file, slot.geometry, fraction => update({ progress: fraction }));
      update({ progress: 1 }); refresh();
    } catch (cause) { update({ error: cause instanceof Error ? cause.message : String(cause) }); }
    finally { update({ busy: false }); }
  }
  async function processClips() {
    if (!run) return;
    if (!selectedUploads.length || repeatedRecording) throw new Error("Select one recording per camera view.");
    for (const uploaded of selectedUploads) {
      const slot = resolvedSlot(slots.findIndex(item => item.cameraId === uploaded.cameraId));
      const invalid = anchorsError(slot.geometry.anchors); if (invalid) throw new Error(invalid);
      // A process request includes the visible geometry edits, even if the separate Save button was missed.
      if (slot.column !== uploaded.primaryColumn || !sameGeometry(slot.geometry, uploaded)) {
        await adapter.updateCamera(run.plan.runId, uploaded.uploadId, slot.column, slot.geometry);
      }
    }
    const job = await adapter.createJob(run.plan.runId, selectedUploads.map(upload => upload.uploadId), evidence);
    setJobId(job.jobId); setProgress(job); setDiagnostics([]); setCandidate(null); setChecked(false);
    try { sessionStorage.setItem(`orchestra:job:${run.plan.runId}`, job.jobId); } catch { /* page-only */ }
  }
  function resolvedSlot(index: number) {
    const slot = slots[index];
    const uploaded = run?.uploads.find(upload => upload.cameraId === slot.cameraId);
    return { ...slot, column: slot.column ?? uploaded?.primaryColumn ?? columns[index], geometry: slot.geometry ?? cameraGeometry(uploaded) };
  }
  const geometryDirty = selectedUploads.some(uploaded => {
    const slot = resolvedSlot(slots.findIndex(item => item.cameraId === uploaded.cameraId));
    return slot.column !== uploaded.primaryColumn || !sameGeometry(slot.geometry, uploaded);
  });
  const activeJob = progress && !["complete", "failed", "cancelled"].includes(progress.stage);
  const now = tick >= 0 && clockReady() ? nowServerMs() : null;
  const finishedCapture = run?.startServerMs !== null && run?.startServerMs !== undefined && now !== null && now >= run.startServerMs + calibrationDurationMs(run.plan);
  return <section>
    <div className="stage-heading"><span className="stage-number">01</span><h2>Calibration</h2><span className="stage-badge">{run ? run.status : "Ready"}</span></div>
    <p className="muted">Record the phone pattern, then upload up to three views here or from <a href="/upload" target="_blank" rel="noreferrer">a camera phone ↗</a>.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!run && <><button className="primary large" disabled={busy || !snapshot} onClick={() => void act(prepare)}>Prepare calibration</button><details><summary>Choose specific phones</summary><label>Target device IDs <input value={targetIds} placeholder="All ready phones" onChange={event => setTargetIds(event.target.value)} /></label></details></>}
    {run && <>
      <p className="muted">Run {run.plan.runTag} · {run.plan.participantIds.length} phones</p>
      {run.reports.length > 0 && <p>{run.reports.filter(report => report.completed).length} phones finished; {run.reports.filter(report => !report.completed).length} interrupted.</p>}
      {run.reports.filter(report => !report.completed).map(report => <p key={report.deviceId}>Device {report.deviceId}: {report.reason ?? "pattern interrupted"}</p>)}
      {barrier && <p>{barrier.readyIds.length}/{barrier.expectedIds.length} ready; {barrier.excluded.length} excluded; {barrier.expectedIds.length - barrier.readyIds.length - barrier.excluded.length} pending.</p>}
      {barrier?.excluded.map(item => <p key={item.deviceId}>Device {item.deviceId}: {item.reason}</p>)}
      {run.status === "created" && <button className="primary large" disabled={busy || !barrier?.readyIds.length || !clockReady()} onClick={() => void act(() => adapter.armCalibration(run.plan.runId, run.preparationId, futureServerMs(4)))}>Cameras recording — start pattern</button>}
      {run.startServerMs !== null && now !== null && <p role="status">{now < run.startServerMs ? `Starts in ${((run.startServerMs - now) / 1000).toFixed(1)} s` : !finishedCapture ? `Pattern running · ${Math.max(0, (run.startServerMs + calibrationDurationMs(run.plan) - now) / 1000).toFixed(1)} s remaining` : "Pattern finished. Stop recordings after the trailing margin, then upload."}</p>}
      <button disabled={busy || !!activeJob} onClick={() => void act(() => adapter.discardCalibration(run.plan.runId))}>Discard run and retry</button>
      <div className="slots">{slots.map((_, index) => {
        const slot = resolvedSlot(index);
        const uploaded = run.uploads.find(upload => upload.cameraId === slot.cameraId);
        const previewIndex = candidate?.cameras.findIndex(camera => camera.cameraId === slot.cameraId) ?? -1;
        return <div className="slot" key={slot.cameraId}><h3>Camera {index + 1}</h3>
          <label>Audience column <select value={slot.column} disabled={!!activeJob} onChange={e => setSlots(current => current.map((item, i) => i === index ? { ...item, column: e.target.value as Column } : item))}>{columns.map(column => <option key={column}>{column}</option>)}</select></label>
          <input type="file" accept="video/*" aria-label={`Camera ${index + 1} video`} disabled={!!activeJob} onChange={e => setSlots(current => current.map((item, i) => i === index ? { ...item, file: e.target.files?.[0] ?? null } : item))} />
          <CameraGeometry file={slot.file} preview={previews[previewIndex] ? { url: previews[previewIndex], rotationDegrees: uploaded?.rotationDegrees ?? 0 } : undefined}
            value={slot.geometry} disabled={busy || !!activeJob} onChange={geometry => setSlots(current => current.map((item, i) => i === index ? { ...item, geometry } : item))} />
          <button disabled={!slot.file || slot.busy || !!uploaded || !finishedCapture} onClick={() => void upload(index)}>{uploaded ? "Uploaded" : slot.busy ? `Uploading ${Math.round(slot.progress * 100)}%` : "Upload recording"}</button>
          {uploaded && <p>{uploaded.label} · {(uploaded.byteSize / 1e6).toFixed(1)} MB · {uploaded.anchors ? "Seating corners saved" : "Automatic approximate frame layout"}</p>}
          {uploaded && <label><input type="checkbox" disabled={!!activeJob || busy} checked={!excludedUploads.includes(uploaded.uploadId)} onChange={event => {
            setExcludedUploads(current => event.target.checked ? current.filter(id => id !== uploaded.uploadId) : [...current, uploaded.uploadId]);
            setCandidate(null); setChecked(false); setJobId(null); setProgress(null); setDiagnostics([]);
            sessionStorage.removeItem(`orchestra:job:${run.plan.runId}`);
          }} /> Include Camera {index + 1} in processing</label>}
          {uploaded && <button disabled={busy || !!activeJob} onClick={() => void act(async () => {
            const invalid = anchorsError(slot.geometry.anchors); if (invalid) throw new Error(invalid);
            await adapter.updateCamera(run.plan.runId, uploaded.uploadId, slot.column, slot.geometry);
            setCandidate(null); setChecked(false); setJobId(null); setProgress(null);
            sessionStorage.removeItem(`orchestra:job:${run.plan.runId}`);
          })}>Save corrected geometry — process again</button>}
          {slot.error && <p role="alert">{slot.error}</p>}
        </div>;
      })}</div>
      <label>Recording source <select value={evidence} onChange={e => setEvidence(e.target.value as typeof evidence)}><option value="physical">Actual camera recordings</option><option value="synthetic">Generated test clips (synthetic)</option></select></label>
      {repeatedRecording && <p role="alert">The same recording is selected more than once. Select one copy per camera view.</p>}
      <button className="primary large" disabled={busy || !selectedUploads.length || repeatedRecording || !!activeJob} onClick={() => void act(processClips)}>{progress?.stage === "failed" || progress?.stage === "cancelled" ? "Retry processing" : "Process uploaded recordings"}</button>
      {progress && <p role="status">{progress.stage} · {Math.round(progress.progress * 100)}% · {progress.message}</p>}
      {progress?.stage === "failed" && diagnostics.length > 0 && <details><summary>Processing diagnostics</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{diagnostics.join("\n")}</pre></details>}
      {activeJob && jobId && <button onClick={() => void act(() => adapter.cancelJob(jobId))}>Cancel processing</button>}
      {candidate && snapshot && <div><h3>Candidate map — awaiting your review</h3>
        {geometryDirty && <p role="alert">Camera geometry has changed. Process the recordings again before committing this map.</p>}
        <p>Evidence: {candidate.evidence}. {decodedCount} devices accepted; {candidate.locations.filter(location => location.status === "localized").length} with map positions; {candidate.locations.filter(location => location.status === "coarse").length} with column only. {candidate.locations.length} eligible phones. Processing {(candidate.processingMs / 1000).toFixed(1)} s.</p>
        {(candidate.locations.some(location => location.mappingMode === "frame-layout") || candidate.cameras.some(camera => usesFrameAnchors(run.uploads.find(upload => upload.cameraId === camera.cameraId)?.anchors ?? null, camera.frameWidth, camera.frameHeight))) && <p role="status">Approximate frame layout: dots follow the recorded screens. A raised phone can appear farther back. Mark the actual seating corners and hold phones at a consistent height for better row placement.</p>}
        {candidate.locations.some(location => location.status === "coarse") && <p role="status">This result predates the automatic layout. Process the recordings again to place decoded phones on the map.</p>}
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
        <label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> I reviewed mapped positions, audience orientation, and unresolved devices.</label>
        {snapshot.transport.status !== "stopped" && <p>Stop playback before committing the map and automatic sections.</p>}
        <button className="primary large" disabled={!checked || busy || geometryDirty || candidateRevision !== snapshot.audienceMap.mapRevision || snapshot.transport.status !== "stopped" || snapshot.pendingActions.length > 0} onClick={() => void act(async () => {
          await adapter.commitMap(run.plan.runId, jobId!, candidateRevision); setCandidate(null); setJobId(null);
        })}>Commit map and assign sections automatically</button>
        {candidateRevision !== snapshot.audienceMap.mapRevision && <p>The map changed during review. Process again against the current map before committing.</p>}
      </div>}
    </>}
  </section>;
}
