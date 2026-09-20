"use client";
import { useEffect, useRef, useState } from "react";
import { AudioContextHost, DecodedBudget, isAudioContextPaused, PlaybackEngine, preloadTracks, type LoadedTrack } from "@orchestra/audio";
import { ClientMessage } from "@orchestra/contracts";
import { ClockSync } from "@orchestra/sync";
import { CalibrationSession, type CalibrationPhase } from "../lib/calibration";
import { browserSocket, ParticipantConnection, type ConnectionState } from "../lib/connection";
import { FlashRenderer } from "../lib/flash-renderer";
import { unlockWithin } from "../lib/audio-unlock";
import { browserStorage, joinSession, tokenKey } from "../lib/join";
import { buildReadiness, statusMessage, StatusReporter } from "../lib/readiness";
import { ShowControl } from "../lib/show-control";
import { participantEndpoints } from "../lib/endpoints";
import { CalibrationOverlay } from "./calibration-overlay";

const { api, wsUrl } = participantEndpoints(typeof window === "undefined" ? "http://localhost:3000" : window.location.origin,
  { api: process.env.NEXT_PUBLIC_API_URL, ws: process.env.NEXT_PUBLIC_WS_URL });
const mock = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "1";
const clockProfile = process.env.NEXT_PUBLIC_CLOCK_PROFILE === "strict" ? "strict" : "internet";
const timers = { setTimeout: (callback: () => void, ms: number) => window.setTimeout(callback, ms), clearTimeout: (handle: unknown) => window.clearTimeout(handle as number) };

function connectionLabel(state: ConnectionState): string {
  const { status } = state;
  switch (status.kind) {
    case "joining": return status.attempt ? `Joining (attempt ${status.attempt + 1})...` : "Joining...";
    case "connected": return "Connected";
    case "reconnecting": return `Reconnecting (attempt ${status.attempt})...`;
    case "gave-up": return "Can't reach the server";
    case "replaced": return "Opened in another tab";
    case "full": return "Session full";
    case "reset": return "The audience has been reset";
  }
}

export default function Page() {
  const connection = useRef<ParticipantConnection | null>(null);
  const [serverClock] = useState(() => new ClockSync({ profile: clockProfile, send: payload => {
    const snapshot = connection.current?.current.snapshot;
    if (snapshot) connection.current?.send({ protocolVersion: 1, sessionId: snapshot.sessionId, serverEpoch: snapshot.serverEpoch,
      messageId: crypto.randomUUID(), type: "clock.probe", payload });
  } }));
  const [clockQuality, setClockQuality] = useState(serverClock.quality());
  const host = useRef<AudioContextHost | null>(null);
  const cache = useRef(new Map<string, LoadedTrack>());
  const budget = useRef(new DecodedBudget());
  const [conn, setConn] = useState<ConnectionState>({ status: { kind: "joining", attempt: 0 }, identity: null, snapshot: null, notice: null });
  const [foreground, setForeground] = useState(true);
  const [audioState, setAudioState] = useState<string | null>(null);
  const [verifiedHashes, setVerifiedHashes] = useState<Record<string, string>>({});
  const [assetNote, setAssetNote] = useState<string | null>(null);
  const [audioNote, setAudioNote] = useState<string | null>(null);
  const [phase, setPhase] = useState<CalibrationPhase>({ kind: "idle" });
  const calibration = useRef<CalibrationSession | null>(null);
  const surface = useRef<HTMLDivElement | null>(null);
  const surfaceText = useRef<HTMLParagraphElement | null>(null);
  const showControl = useRef<ShowControl | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const session = new CalibrationSession(
      message => { connection.current?.send(message); },
      () => {
        const state = connection.current?.current;
        return state?.identity && state.snapshot ? { sessionId: state.snapshot.sessionId, serverEpoch: state.snapshot.serverEpoch, deviceId: state.identity.deviceId } : null;
      },
      setPhase,
    );
    calibration.current = session;
    const control = new ShowControl({
      send: message => { connection.current?.send(message); },
      identity: () => {
        const state = connection.current?.current;
        return state?.identity && state.snapshot ? { sessionId: state.snapshot.sessionId, serverEpoch: state.snapshot.serverEpoch, deviceId: state.identity.deviceId } : null;
      },
      facts: () => ({
        audioRunning: host.current?.state === "running",
        clockUsable: document.visibilityState === "visible" && serverClock.quality().ready,
        verified: (trackId, sha256) => cache.current.get(trackId)?.sha256 === sha256,
      }),
      preload: async showToLoad => {
        const audio = host.current;
        if (!audio) return;
        await preloadTracks(showToLoad.tracks, { ctx: audio.context(), budget: budget.current, baseUrl: api }, cache.current);
        setVerifiedHashes(Object.fromEntries([...cache.current.values()].map(track => [track.trackId, track.sha256])));
      },
      now: () => serverClock?.nowServerMs() ?? null,
    });
    showControl.current = control;
    const client = new ParticipantConnection({
      wsUrl,
      join: () => joinSession({ api, sessionId: new URLSearchParams(window.location.search).get("session") ?? process.env.NEXT_PUBLIC_SESSION_ID ?? (mock ? "demo" : "dev-session"), storage: browserStorage() }),
      openSocket: browserSocket,
      onReset: () => {
        const sessionId = connection.current?.current.identity?.sessionId;
        if (sessionId) browserStorage().removeItem(tokenKey(sessionId));
      },
      onChange: state => {
        // A run can't survive losing the socket or a server restart.
        if (state.status.kind !== "connected") { session.abort("disconnected"); control.disconnected(); serverClock.stop(); }
        else if (state.snapshot) serverClock.start(state.snapshot.serverEpoch);
        setConn(state);
      },
      onMessage: message => {
        if (message.type === "clock.reply") serverClock.accept({ ...message.payload, serverEpoch: message.serverEpoch });
        else if (message.type === "calibration.prepare") {
          session.onPrepare(message, { foreground: document.visibilityState === "visible", clockUsable: serverClock.quality().ready, optedOut: false });
        } else if (message.type === "calibration.arm" && serverClock.quality().ready) {
          session.onArm(message, serverClock.nowServerMs());
        } else {
          control.handle(message);
        }
      },
      timers,
    });
    connection.current = client;
    const onVisibility = () => {
      const visible = document.visibilityState === "visible";
      setForeground(visible);
      if (!visible) session.abort("hidden");
      if (visible) { serverClock.refresh(); client.wake(); }
    };
    const onOnline = () => client.wake();
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    client.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      client.stop();
      serverClock.stop();
    };
  }, []);

  // Report readiness whenever any local fact changes; a fresh connection always gets a fresh report.
  const reporter = useRef<StatusReporter | null>(null);
  const connected = conn.status.kind === "connected";
  useEffect(() => {
    reporter.current ??= new StatusReporter(readiness => {
      const snapshot = connection.current?.current.snapshot;
      return !!snapshot && !!connection.current?.send(statusMessage(snapshot, readiness));
    }, timers);
    if (connected) reporter.current.reset();
  }, [connected, conn.snapshot?.serverEpoch]);
  useEffect(() => {
    if (!conn.identity || !connected) return;
    reporter.current?.update(buildReadiness(conn.identity.deviceId, { connected, foreground, clock: clockQuality, audioState, verifiedHashes }));
  }, [conn.identity, connected, foreground, clockQuality, audioState, verifiedHashes, conn.snapshot?.serverEpoch]);
  useEffect(() => () => reporter.current?.dispose(), []);

  // Download and decode while the browser waits for an audio gesture too.
  const show = conn.snapshot?.show;
  const showKey = JSON.stringify([show?.showId, show?.showRevision, show?.tracks]);
  useEffect(() => {
    const audio = host.current;
    if (!show || !audioState || !audio) return;
    let cancelled = false;
    setAssetNote(`Loading ${show.tracks.length} tracks...`);
    preloadTracks(show.tracks, { ctx: audio.context(), budget: budget.current, baseUrl: api }, cache.current).then(failures => {
      if (cancelled) return;
      setVerifiedHashes(Object.fromEntries([...cache.current.values()].map(track => [track.trackId, track.sha256])));
      setAssetNote(failures.length ? `Failed: ${failures.map(failure => failure.message).join("; ")}` : null);
    });
    return () => { cancelled = true; };
  }, [showKey, audioState]);

  // Every new authoritative snapshot rebuilds playback state (reconnect, late join).
  useEffect(() => {
    if (connected && conn.snapshot) showControl.current?.applySnapshot(conn.snapshot);
  }, [conn.snapshot, connected]);

  // The engine exists only while audio runs and a server clock exists. It is rebuilt when verified
  // tracks change, so a finished preload is picked up; a resumed context gets a fresh engine too.
  useEffect(() => {
    const audio = host.current;
    const control = showControl.current;
    if (!audio || !control || audioState !== "running" || !connected || !clockQuality.ready) return;
    const engine = new PlaybackEngine({ ctx: audio.context(), output: audio.masterGain, clock: serverClock, buffer: trackId => cache.current.get(trackId)?.buffer });
    control.attach(engine);
    const housekeeping = window.setInterval(() => engine.tick(), 1000);
    return () => { window.clearInterval(housekeeping); control.attach(null); engine.dispose(); };
  }, [audioState, verifiedHashes, connected, clockQuality.ready, conn.snapshot?.serverEpoch]);

  // Refresh the playback display (playhead, countdowns, received commands) whether or not audio runs.
  useEffect(() => {
    const refresh = window.setInterval(() => { setTick(value => value + 1); setClockQuality(serverClock.quality()); }, 250);
    return () => window.clearInterval(refresh);
  }, []);

  // Run the flash only while armed. The renderer paints the overlay directly, one colour per frame.
  useEffect(() => {
    if (phase.kind !== "armed" || !clockQuality.ready) return;
    const session = calibration.current!;
    let wakeLock: WakeLockSentinel | null = null;
    navigator.wakeLock?.request("screen").then(lock => { wakeLock = lock; }, () => {});
    const renderer = new FlashRenderer({
      clock: serverClock,
      clockUsable: () => serverClock.quality().ready,
      run: phase.run,
      packet: phase.packet,
      frames: { request: callback => requestAnimationFrame(callback), cancel: handle => cancelAnimationFrame(handle as number) },
      paint: (color, text) => {
        if (surface.current) surface.current.style.background = color;
        if (surfaceText.current) surfaceText.current.textContent = text ?? "";
      },
      onDone: maxFrameLatenessMs => session.complete(maxFrameLatenessMs),
      onClockLost: () => session.abort("clock"),
    });
    renderer.start();
    return () => { renderer.stop(); void wakeLock?.release().catch(() => {}); };
  }, [phase]);

  async function enableSound(automatic = false) {
    if (!host.current) {
      host.current = new AudioContextHost();
      host.current.onStateChange(setAudioState);
    }
    host.current.context();
    setAudioState(host.current.state);
    if (!automatic) setAudioNote("Starting sound…");
    const outcome = await unlockWithin(() => host.current!.unlock(), timers);
    setAudioNote(host.current?.state === "running" || automatic ? null : outcome.kind === "error" ? "Sound could not start. Tap to try again." : "Tap once more to enable sound.");
    setAudioState(host.current?.state ?? null);
  }

  useEffect(() => {
    void enableSound(true);
    const gesture = () => { if (host.current?.state !== "running") void enableSound(true); };
    window.addEventListener("pointerdown", gesture, { passive: true });
    window.addEventListener("keydown", gesture);
    return () => { window.removeEventListener("pointerdown", gesture); window.removeEventListener("keydown", gesture); void host.current?.dispose(); };
  }, []);

  const identity = conn.identity;
  const tracks = show?.tracks ?? [];
  const assetsVerified = tracks.length > 0 && tracks.every(track => verifiedHashes[track.trackId] === track.sha256);
  const location = conn.snapshot?.location;
  const stage = conn.snapshot?.calibrationStage ?? "waiting";
  const section = location?.column;
  const mapped = location?.status === "localized" || location?.mappingMode === "optical-column";
  const manual = location?.mappingMode === "manual-column";
  const needsSection = connected && stage === "complete" && !mapped && !manual && phase.kind !== "armed";
  const holding = phase.kind === "prepared" || phase.kind === "armed";
  const awaitingMap = phase.kind === "finished" && stage !== "complete" || stage === "processing";
  const playing = conn.snapshot?.transport.status === "playing";
  const channel = show?.channels.find(value => value.channelId === conn.snapshot?.assignment.channelId);
  const reset = conn.status.kind === "reset";
  const checks = [
    { label: "Connection", value: connected ? "Connected" : connectionLabel(conn), ok: connected },
    { label: "Show clock", value: clockQuality.ready ? "In sync" : "Syncing…", ok: clockQuality.ready },
    { label: "Music", value: assetsVerified ? "Verified" : tracks.length ? "Loading…" : "Waiting for show", ok: assetsVerified },
  ];
  function chooseSection(column: "left" | "center" | "right") {
    const snapshot = connection.current?.current.snapshot;
    if (snapshot) connection.current?.send(ClientMessage.parse({ protocolVersion: 1, sessionId: snapshot.sessionId, serverEpoch: snapshot.serverEpoch,
      messageId: crypto.randomUUID(), type: "participant.column", payload: { column } }));
  }

  return <main className="audience-shell">
    <header className="audience-brand"><span className="brand-mark" aria-hidden="true">◒</span><span>AUDIENCE<br />ORCHESTRA</span>
      <span className="device-number">{identity ? `PHONE ${String(identity.deviceId).padStart(3, "0")}` : "LIVE EXPERIENCE"}</span></header>
    {mock && <p className="notice">Test session</p>}
    <div className={`audience-orbit ${connected ? "ready" : ""}`} aria-hidden="true"><span>♪</span></div>
    <p className="eyebrow">{reset ? "SESSION RESET" : playing ? "THE SHOW IS LIVE" : holding ? "CALIBRATION" : mapped || manual ? "YOU’RE IN POSITION" : "YOUR PHONE. PART OF THE ORCHESTRA."}</p>
    <h1>{reset ? "Ready for a fresh start." : holding ? "Raise your phone." : needsSection ? "Where are you sitting?" : mapped || manual ? `${section?.toUpperCase()} SECTION` : awaitingMap ? "Finding your place." : "You’re part of the show."}</h1>
    <p className="audience-instruction">{reset ? "Refresh this page when you’re ready to join again." : holding ? "Face your screen toward the stage and hold it steady." : needsSection ? "We couldn’t locate your phone. Choose your section while facing the stage." : awaitingMap ? "You can lower your phone. We’re processing the camera recordings." : "Turn your volume all the way up. Keep this page open and wait for the stage team."}</p>
    {!reset && <div className="audience-checks" aria-label="Phone readiness">{checks.map(check => <div key={check.label}><span className={check.ok ? "status-dot ok" : "status-dot"} /><span>{check.label}</span><strong>{check.value}</strong></div>)}</div>}
    {!reset && audioState !== "running" && <div className="sound-prompt"><button className="primary" onClick={() => void enableSound()}>{isAudioContextPaused(audioState) ? "Tap to enable sound" : "Enable sound"}</button><small>Your browser needs one tap before it can play music.</small></div>}
    {audioNote && <p role="alert" className="notice">{audioNote}</p>}
    {assetNote?.startsWith("Failed:") && <p role="alert" className="notice">Music couldn’t finish loading. Keep this page open while the stage team checks the connection.</p>}
    {needsSection && <div className="section-picker">{(["left", "center", "right"] as const).map(column => <button key={column} onClick={() => chooseSection(column)}>{column}</button>)}</div>}
    {(mapped || manual) && !holding && channel && <p className="your-part"><span style={{ background: channel.color }} />Your part: <strong>{channel.label}</strong></p>}
    {conn.status.kind === "gave-up" && <button onClick={() => connection.current?.retry()}>Reconnect</button>}
    {conn.status.kind === "replaced" && <p className="notice">This phone is open in another tab. Keep just one tab open.</p>}
    {!foreground && !reset && <p className="notice">Return to this page to stay ready.</p>}
    <footer className="audience-footer">ONE AUDIENCE. ONE ORCHESTRA.</footer>
    {phase.kind === "armed" && <CalibrationOverlay surface={surface} text={surfaceText} />}
  </main>;
}
