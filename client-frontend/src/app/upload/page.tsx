"use client";
import { useEffect, useState } from "react";
import { CameraRequestError, cameraRequest, sendVideo, type UploadSession } from "../../lib/camera-upload";
import { Star } from "../star";
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
  const pct = Math.round(progress * 100);

  // Same rule as the audience view: the biggest line says what this operator does next.
  const say: { title: string; sub: string | null } =
    !token ? { title: "Sign in.", sub: "Use the upload password from the stage team." }
    : done ? { title: "Recording sent.", sub: `The stage team has the ${column} camera.` }
    : busy ? { title: progress === 1 ? "Checking the file." : `Sending. ${pct}%`, sub: "Keep this page open." }
    : !run ? { title: "Waiting for the stage team.", sub: "Calibration has not started." }
    : !run.canUpload ? { title: "Keep filming.", sub: "Wait for the phones to finish flashing." }
    : taken ? { title: "Already sent.", sub: "Pick another section if you filmed one." }
    : !file ? { title: "Choose your recording.", sub: "The original video, up to 1 GiB." }
    : { title: "Send your recording.", sub: null };

  return <main className="screen">
    <header className="screen-top">
      <b><Star />Concerto</b>
      <span>Camera crew</span>
    </header>

    <div className="screen-main">
      <h1 className="say">{say.title}</h1>
      {say.sub && <p className="sub">{say.sub}</p>}

      {!token
        ? <form className="field" onSubmit={event => { event.preventDefault(); void login(); }}>
            <label htmlFor="camera-password">Upload password</label>
            <input id="camera-password" type="password" value={password} autoComplete="current-password" onChange={event => setPassword(event.target.value)} />
            <div className="field"><button className="primary" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button></div>
          </form>
        : <>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} disabled={busy || done}>
              <legend style={{ padding: 0 }}><span className="sub">Your section, facing the stage</span></legend>
              <div className="act-row field">{["left", "center", "right"].map(value =>
                <button type="button" key={value} aria-pressed={column === value}
                  style={column === value ? { background: "#f2f2f0", color: "#0b0b0b", fontWeight: 700 } : undefined}
                  onClick={() => setColumn(value)}>{value}</button>)}</div>

              <label className="pick field">
                <strong>{file?.name ?? "Choose your recording"}</strong>
                <span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MiB` : "Original video, up to 1 GiB"}</span>
                <input type="file" accept="video/*" aria-label="Camera recording" onChange={event => setFile(event.target.files?.[0] ?? null)} />
              </label>

              <details>
                <summary>Camera rotation</summary>
                <label htmlFor="rotation">Rotate clockwise</label>
                <select id="rotation" value={rotation} onChange={event => setRotation(Number(event.target.value))}>
                  {[0, 90, 180, 270].map(value => <option key={value} value={value}>{value}°</option>)}
                </select>
              </details>
            </fieldset>

            {busy && <div className="field"><div className="bar"><i style={{ width: `${pct}%` }} /></div></div>}

            {!done && <div className="field"><button className="primary" onClick={() => void upload()} disabled={busy || !file || !run?.canUpload || taken}>
              {busy ? "Sending…" : transfer ? "Send the rest" : "Send recording"}</button></div>}
          </>}

      {error && <p role="alert" className="warn">{error}</p>}
      {offline && <p role="status" className="warn">Connection dropped. Your sent chunks are saved.</p>}
    </div>

    {run?.uploads.length ? <footer className="rows">
      {run.uploads.map(upload => <div key={upload.column}><span>{upload.column}</span><span>Received</span></div>)}
    </footer> : <footer className="screen-foot" />}
  </main>;
}
