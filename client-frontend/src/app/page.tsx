"use client";
import { useEffect, useRef, useState } from "react";
import { AudioContextHost, DecodedBudget, isAudioContextPaused, PlaybackEngine, preloadTracks, type LoadedTrack } from "@orchestra/audio";
import type { ShowData } from "@orchestra/contracts";
import { CalibrationSession, type CalibrationPhase } from "../lib/calibration";
import { browserSocket, ParticipantConnection, type ConnectionState } from "../lib/connection";
import { fixtureClock } from "../lib/fixture-clock";
import { FlashRenderer } from "../lib/flash-renderer";
import { unlockWithin } from "../lib/audio-unlock";
import { browserStorage, joinSession } from "../lib/join";
import { buildReadiness, statusMessage, StatusReporter } from "../lib/readiness";
import { ShowControl, type PlaybackView } from "../lib/show-control";
import { participantStatus } from "../lib/status";
import { CalibrationOverlay } from "./calibration-overlay";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";
const sessionId = process.env.NEXT_PUBLIC_SESSION_ID ?? "demo";
const mock = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "1";
// Calibration and playback use only the server clock. Team 1's clock isn't wired in yet, so production has
// none and answers "clock". Mock mode uses the labelled local fixture clock.
const serverClock = mock ? fixtureClock : null;
const timers = { setTimeout: (callback: () => void, ms: number) => window.setTimeout(callback, ms), clearTimeout: (handle: unknown) => window.clearTimeout(handle as number) };

function calibrationLabel(phase: CalibrationPhase, optedOut: boolean): string {
  if (optedOut) return "Calibration: skipped";
  switch (phase.kind) {
    case "idle": return serverClock ? "Calibration: waiting for the operator" : "Calibration: not available until the server clock is connected";
    case "prepared": return "Calibration: ready, waiting for the start";
    case "armed": return "Calibration: running";
    case "finished": return phase.completed ? "Calibration: done" : `Calibration: didn't finish (${phase.reason})`;
  }
}

const clockTime = (ms: number) => `${Math.floor(ms / 60000)}:${(Math.floor(ms / 1000) % 60).toString().padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`;

function playbackLabels(view: PlaybackView, show: ShowData | undefined, nowServerMs: number | null): { channel: string; color: string | null; transport: string; pending: string[] } {
  const channelName = (id: string | null) => id === null ? "no channel" : show?.channels.find(channel => channel.channelId === id)?.label ?? id;
  const inSeconds = (at: number) => nowServerMs === null ? "" : ` in ${Math.max(0, (at - nowServerMs) / 1000).toFixed(1)} s`;
  const t = view.transport;
  const transport = view.panicked ? "Muted by operator"
    : !t || t.status === "stopped" ? "Stopped"
    : t.status === "paused" ? `Paused at ${clockTime(view.positionMs)}`
    : nowServerMs !== null && nowServerMs < t.startServerMs ? `Starting at ${clockTime(t.positionMs)}${inSeconds(t.startServerMs)}`
    : `Playing ${clockTime(view.positionMs)}`;
  const pending: string[] = [];
  if (view.pendingChannel) pending.push(`Switching to ${channelName(view.pendingChannel.value)}${inSeconds(view.pendingChannel.atServerMs)}`);
  if (view.pendingTransport) pending.push(`${view.pendingTransport.value.status === "playing" ? "Play" : view.pendingTransport.value.status === "paused" ? "Pause" : "Stop"}${inSeconds(view.pendingTransport.atServerMs)}`);
  return { channel: channelName(view.channelId), color: show?.channels.find(channel => channel.channelId === view.channelId)?.color ?? null, transport, pending };
}

function connectionLabel(state: ConnectionState): string {
  const { status } = state;
  switch (status.kind) {
    case "joining": return status.attempt ? `Joining (attempt ${status.attempt + 1})...` : "Joining...";
    case "connected": return "Connected";
    case "reconnecting": return `Reconnecting (attempt ${status.attempt})...`;
    case "gave-up": return "Can't reach the server";
    case "replaced": return "Opened in another tab";
    case "full": return "Session full";
  }
}

export default function Page() {
  const connection = useRef<ParticipantConnection | null>(null);
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
  const [optedOut, setOptedOut] = useState(false);
  const optedOutRef = useRef(false);
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
        clockUsable: serverClock !== null,
        verified: (trackId, sha256) => cache.current.get(trackId)?.sha256 === sha256,
      }),
      preload: async showToLoad => {
        const audio = host.current;
        if (!audio || audio.state !== "running") return;
        await preloadTracks(showToLoad.tracks, { ctx: audio.context(), budget: budget.current, baseUrl: api }, cache.current);
        setVerifiedHashes(Object.fromEntries([...cache.current.values()].map(track => [track.trackId, track.sha256])));
      },
      now: () => serverClock?.nowServerMs() ?? null,
    });
    showControl.current = control;
    const client = new ParticipantConnection({
      wsUrl,
      join: () => joinSession({ api, sessionId, storage: browserStorage() }),
      openSocket: browserSocket,
      onChange: state => {
        // A run can't survive losing the socket or a server restart.
        if (state.status.kind !== "connected") { session.abort("disconnected"); control.disconnected(); }
        setConn(state);
      },
      onMessage: message => {
        if (message.type === "calibration.prepare") {
          session.onPrepare(message, { foreground: document.visibilityState === "visible", clockUsable: serverClock !== null, optedOut: optedOutRef.current });
        } else if (message.type === "calibration.arm" && serverClock) {
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
      if (visible) client.wake();
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
    reporter.current?.update(buildReadiness(conn.identity.deviceId, { connected, foreground, clock: null, audioState, verifiedHashes }));
  }, [conn.identity, connected, foreground, audioState, verifiedHashes, conn.snapshot?.serverEpoch]);
  useEffect(() => () => reporter.current?.dispose(), []);

  // Preload the show once audio is unlocked; only hash-verified tracks count.
  const show = conn.snapshot?.show;
  useEffect(() => {
    const audio = host.current;
    if (!show || audioState !== "running" || !audio) return;
    let cancelled = false;
    setAssetNote(`Loading ${show.tracks.length} tracks...`);
    preloadTracks(show.tracks, { ctx: audio.context(), budget: budget.current, baseUrl: api }, cache.current).then(failures => {
      if (cancelled) return;
      setVerifiedHashes(Object.fromEntries([...cache.current.values()].map(track => [track.trackId, track.sha256])));
      setAssetNote(failures.length ? `Failed: ${failures.map(failure => failure.message).join("; ")}` : null);
    });
    return () => { cancelled = true; };
  }, [show, audioState]);

  // Every new authoritative snapshot rebuilds playback state (reconnect, late join).
  useEffect(() => {
    if (conn.snapshot) showControl.current?.applySnapshot(conn.snapshot);
  }, [conn.snapshot]);

  // The engine exists only while audio runs and a server clock exists. It is rebuilt when verified
  // tracks change, so a finished preload is picked up; a resumed context gets a fresh engine too.
  useEffect(() => {
    const audio = host.current;
    const control = showControl.current;
    if (!audio || !control || audioState !== "running" || !serverClock) return;
    const engine = new PlaybackEngine({ ctx: audio.context(), output: audio.masterGain, clock: serverClock, buffer: trackId => cache.current.get(trackId)?.buffer });
    control.attach(engine);
    const housekeeping = window.setInterval(() => engine.tick(), 1000);
    return () => { window.clearInterval(housekeeping); control.attach(null); engine.dispose(); };
  }, [audioState, verifiedHashes]);

  // Refresh the playback display (playhead, countdowns, received commands) whether or not audio runs.
  useEffect(() => {
    const refresh = window.setInterval(() => setTick(value => value + 1), 250);
    return () => window.clearInterval(refresh);
  }, []);

  // Run the flash only while armed. The renderer paints the overlay directly, one colour per frame.
  useEffect(() => {
    if (phase.kind !== "armed" || !serverClock) return;
    const session = calibration.current!;
    let wakeLock: WakeLockSentinel | null = null;
    navigator.wakeLock?.request("screen").then(lock => { wakeLock = lock; }, () => {});
    const renderer = new FlashRenderer({
      clock: serverClock,
      clockUsable: () => serverClock !== null,
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

  function toggleSkip() {
    const next = !optedOutRef.current;
    optedOutRef.current = next;
    setOptedOut(next);
    if (next) calibration.current?.abort("opted-out");
  }

  async function enableSound() {
    if (!host.current) {
      host.current = new AudioContextHost();
      host.current.onStateChange(setAudioState);
    }
    setAudioNote("Unlocking audio...");
    const outcome = await unlockWithin(() => host.current!.unlock(), timers);
    setAudioNote(outcome.kind === "running" ? null : outcome.kind === "timeout" ? "Sound didn't start. Tap the sound button again." : `Audio failed: ${outcome.message}`);
    setAudioState(host.current.state);
  }

  const identity = conn.identity;
  const readiness = identity ? buildReadiness(identity.deviceId, { connected, foreground, clock: null, audioState, verifiedHashes }) : null;
  const tracks = show?.tracks ?? [];
  const assetsVerified = tracks.length > 0 && tracks.every(track => verifiedHashes[track.trackId] === track.sha256);
  const checks: [string, boolean][] = readiness ? [
    ["Connected", readiness.connected],
    ["Clock synced", readiness.clockReady],
    ["Page in foreground", readiness.foreground],
    ["Audio unlocked", readiness.audioUnlocked],
    [`Assets verified (${Object.keys(verifiedHashes).length}/${tracks.length})`, assetsVerified],
  ] : [];
  const kind = conn.status.kind;
  const playback = showControl.current && show ? playbackLabels(showControl.current.view(), show, serverClock?.nowServerMs() ?? null) : null;

  return <main>
    <p className="eyebrow">AUDIENCE ORCHESTRA / TEAM 2</p>
    <h1>Audience client</h1>
    {mock && <p className="notice">SYNTHETIC MOCK SERVER</p>}
    <section>
      <h2>{identity ? `Device ${identity.deviceId}` : "Joining the show"}</h2>
      <p className="status" role="status">{connectionLabel(conn)}</p>
      {conn.notice && <p role="alert">{conn.notice}</p>}
      {(kind === "gave-up" || kind === "replaced") && <button type="button" onClick={() => connection.current?.retry()}>{kind === "replaced" ? "Use this tab instead" : "Tap to reconnect"}</button>}
      {conn.snapshot && readiness && <p>{participantStatus({ ...conn.snapshot, readiness })}</p>}
      <ul className="checks">{checks.map(([label, ok]) => <li key={label} className={ok ? "ok" : "no"}>{ok ? "✓" : "✗"} {label}</li>)}</ul>
      <p>The clock sync comes from Team 1 and isn&apos;t connected yet, so &quot;Clock synced&quot; stays off.</p>
      {identity && audioState !== "running" && <button type="button" onClick={enableSound}>{isAudioContextPaused(audioState) ? "Tap to resume sound" : "Enable sound"}</button>}
      {audioNote && <p role="alert">{audioNote}</p>}
      {assetNote && <p>{assetNote}</p>}
      <p>{calibrationLabel(phase, optedOut)}</p>
      {identity && phase.kind !== "armed" && <button type="button" onClick={toggleSkip}>{optedOut ? "Take part in calibration" : "Skip calibration"}</button>}
    </section>
    {playback && <section>
      <h2><span className="swatch" style={{ background: playback.color ?? "transparent" }} /> Channel: {playback.channel}</h2>
      <p className="status">{playback.transport}</p>
      {playback.pending.map(line => <p key={line}>{line}</p>)}
      {!serverClock && <p>Playback needs the server clock from Team 1, so this phone stays silent for now.</p>}
      {serverClock && audioState !== "running" && <p>Enable sound to play your part.</p>}
    </section>}
    {phase.kind === "armed" && <CalibrationOverlay surface={surface} text={surfaceText} onSkip={toggleSkip} />}
  </main>;
}
