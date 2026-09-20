"use client";
import { useEffect, useState } from "react";
import { CameraRequestError, cameraRequest, sendVideo, type UploadSession } from "../../lib/camera-upload";
type CameraRun = { runId: string; status: string; canUpload: boolean; uploads: { column: string; label: string; byteSize: number }[] };

export default function UploadPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [run, setRun] = useState<CameraRun | null>(null);
  const [column, setColumn] = useState("center");
  const [rotation, setRotation] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [transfer, setTransfer] = useState<UploadSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => { try { setToken(sessionStorage.getItem("orchestra:camera-access") ?? ""); } catch { /* page-only */ } }, []);
  useEffect(() => {
    if (!token) return;
    let current = true;
    const read = async () => { try { const data = await cameraRequest("/session", token); if (current) { setRun(data.run); setOffline(false); } }
      catch (cause) { if (current) {
        if (cause instanceof CameraRequestError && cause.status === 401) { setError(cause.message); setToken(""); try { sessionStorage.removeItem("orchestra:camera-access"); } catch { /* page-only */ } }
        else setOffline(true);
      } } };
    void read(); const timer = setInterval(read, 2500);
    return () => { current = false; clearInterval(timer); };
  }, [token]);
  useEffect(() => { setTransfer(null); setProgress(0); setDone(false); }, [file, column, rotation, run?.runId, token]);
  async function login() {
    setBusy(true); setError(null);
    try { const result = await cameraRequest("/login", "", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      setToken(result.token); setPassword(""); try { sessionStorage.setItem("orchestra:camera-access", result.token); } catch { /* page-only */ }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }
  async function upload() {
    if (!file || !run) return;
    setBusy(true); setError(null);
    try {
      if (file.size > 1024 * 1024 * 1024) throw new Error("Choose a recording smaller than 1 GiB.");
      const session: UploadSession = transfer ?? await cameraRequest("/uploads", token, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: run.runId, column, label: file.name, byteSize: file.size, rotationDegrees: rotation }) });
      setTransfer(session);
      await sendVideo(file, session, token, setProgress);
      setDone(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Upload interrupted. Keep this page open and retry."); } finally { setBusy(false); }
  }
  const taken = run?.uploads.some(upload => upload.column === column);
  return <main className="upload-shell"><header className="audience-brand"><span className="brand-mark">◒</span><span>Concerto</span><span className="device-number">CAMERA CREW</span></header>
    <p className="eyebrow">FROM CAMERA TO CONCERT</p><h1>Send your<br />camera view.</h1><p className="audience-instruction">Upload the original recording. The stage team will handle calibration.</p>
    {!token ? <form className="upload-card" onSubmit={event => { event.preventDefault(); void login(); }}><label>Upload password<input type="password" value={password} autoComplete="current-password" onChange={event => setPassword(event.target.value)} /></label><button className="primary" disabled={busy || !password}>{busy ? "Connecting…" : "Connect camera"}</button></form>
      : <section className="upload-card"><div className="upload-state"><i className={`status-dot ${run?.canUpload ? "ok" : ""}`} />{run?.canUpload ? "Ready for your recording" : run ? "Wait for the phone pattern to finish" : "Waiting for the stage team to start calibration"}</div>
        <fieldset disabled={busy || done}><legend>Audience section · facing the stage</legend><div className="section-picker">{["left", "center", "right"].map(value => <button type="button" aria-pressed={column === value} className={column === value ? "chosen" : ""} key={value} onClick={() => setColumn(value)}>{value}</button>)}</div>
          <label className="file-drop"><span aria-hidden="true">↑</span><strong>{file?.name ?? "Choose your recording"}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MiB` : "Original video · up to 1 GiB"}</small><input type="file" accept="video/*" aria-label="Camera recording" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
          <p className="muted">Record from the stage facing the audience. Screen positions are mapped automatically; the stage team can refine the seating layout.</p>
          <details><summary>Camera orientation</summary><label>Rotate clockwise<select value={rotation} onChange={event => setRotation(Number(event.target.value))}>{[0, 90, 180, 270].map(value => <option key={value} value={value}>{value}°</option>)}</select></label></details>
        </fieldset>
        {taken && !done && <p className="notice">This section’s recording is already with the stage team.</p>}
        {busy && <div className="upload-progress"><progress value={progress} max={1} /><p>{progress === 1 ? "Verifying the recording…" : `Uploading · ${Math.round(progress * 100)}%`}</p></div>}
        {done ? <div className="upload-success"><strong>✓ Recording delivered</strong><p>You’re done. The stage team can now process the {column} camera.</p></div> : <button className="primary" onClick={() => void upload()} disabled={busy || !file || !run?.canUpload || taken}>{busy ? "Sending recording…" : transfer ? "Retry upload" : "Upload recording"}</button>}
        <small>Keep this page open until delivery is confirmed. If the connection drops, Retry continues the same upload.</small>
      </section>}
    {error && <p role="alert" className="notice">{error}</p>}
    {offline && <p role="status" className="notice">Connection interrupted. Keep this page open; your uploaded progress is saved.</p>}
    {run?.uploads.length ? <div className="received-cameras"><p className="eyebrow">RECEIVED BY THE STAGE</p>{run.uploads.map(upload => <p key={upload.column}><strong>{upload.column}</strong><span>✓ Received</span></p>)}</div> : null}
  </main>;
}
