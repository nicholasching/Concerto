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
import { Star } from "./star";
import { Checks, type CheckState } from "./checks";

const { api, wsUrl } = participantEndpoints(typeof window === "undefined" ? "http://localhost:3000" : window.location.origin,
  { api: process.env.NEXT_PUBLIC_API_URL, ws: process.env.NEXT_PUBLIC_WS_URL });
const mock = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "1";
const clockProfile = process.env.NEXT_PUBLIC_CLOCK_PROFILE === "strict" ? "strict" : "internet";
const timers = { setTimeout: (callback: () => void, ms: number) => window.setTimeout(callback, ms), clearTimeout: (handle: unknown) => window.clearTimeout(handle as number) };

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
  const [outputReady, setOutputReady] = useState(false);
  const [forceSound, setForceSound] = useState(false);
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
        audioOutputReady: host.current?.outputReady() ?? false,
        clockUsable: connection.current?.current.status.kind === "connected" && document.visibilityState === "visible" && serverClock.quality().ready,
        verified: (trackId, sha256) => cache.current.get(trackId)?.sha256 === sha256,
      }),
      preload: async showToLoad => {
        const audio = host.current;
        if (!audio) return;
        await preloadTracks(showToLoad.tracks, { ctx: audio.context(), budget: budget.current, baseUrl: api }, cache.current);
        setVerifiedHashes(Object.fromEntries([...cache.current.values()].map(track => [track.trackId, track.sha256])));
      },
      now: () => serverClock.quality().ready ? serverClock.nowServerMs() : null,
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
        else if (state.snapshot) {
          serverClock.start(state.snapshot.serverEpoch);
          control.applySnapshot(state.snapshot);
        }
        setClockQuality(serverClock.quality());
        setConn(state);
      },
      onMessage: message => {
        if (message.type === "clock.reply") {
          serverClock.accept({ ...message.payload, serverEpoch: message.serverEpoch });
          control.refreshReadiness();
        }
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
      control.refreshReadiness();
      setClockQuality(serverClock.quality());
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
      showControl.current?.refreshReadiness();
    });
    return () => { cancelled = true; };
  }, [showKey, audioState]);

  // ShowControl gates every engine call on fresh clock/output/assets. Keep the engine stable
  // across telemetry and asset reports; reconnect or context interruption gets a new graph.
  useEffect(() => {
    const audio = host.current;
    const control = showControl.current;
    if (!audio || !control || audioState !== "running" || !connected) return;
    const engine = new PlaybackEngine({ ctx: audio.context(), output: audio.masterGain, clock: serverClock, buffer: trackId => cache.current.get(trackId)?.buffer });
    control.attach(engine);
    const housekeeping = window.setInterval(() => engine.tick(), 1000);
    return () => { window.clearInterval(housekeeping); control.attach(null); engine.dispose(); };
  }, [audioState, connected, conn.snapshot?.serverEpoch]);

  // Refresh the playback display (playhead, countdowns, received commands) whether or not audio runs.
  useEffect(() => {
    const refresh = window.setInterval(() => {
      showControl.current?.refreshReadiness();
      setOutputReady(host.current?.outputReady() ?? false);
      setTick(value => value + 1);
      setClockQuality(serverClock.quality());
    }, 250);
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
      host.current.onStateChange(state => {
        showControl.current?.refreshReadiness();
        setAudioState(state);
        setOutputReady(false);
      });
    }
    host.current.context();
    setAudioState(host.current.state);
    if (!automatic) setAudioNote("Starting sound…");
    const outcome = await unlockWithin(() => host.current!.unlock(), timers);
    setAudioNote(host.current?.state === "running" || automatic ? null : outcome.kind === "error" ? "Sound could not start. Tap to try again." : "Tap once more to enable sound.");
    setAudioState(host.current?.state ?? null);
  }

  // Dev-only preview flag. `?forceSound=1` pins the sound prompt open so that state can be
  // styled without fighting the browser's autoplay policy. Read in an effect, not during render,
  // so the server and client markup still match. Stripped from any production build.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    setForceSound(new URLSearchParams(window.location.search).get("forceSound") === "1");
  }, []);

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
  const soundOff = forceSound || (connected && audioState !== "running");
  const soundReady = outputReady && !forceSound;

  // The biggest line on the screen is always this person's status, or the thing they must do
  // next. First match wins, most urgent first. `color` is the single accent and only ever
  // carries the channel colour.
  const say: { title: string; sub: string | null } =
    reset ? { title: "This session ended.", sub: "Refresh the page to join again." }
    : conn.status.kind === "replaced" ? { title: "Open in another tab.", sub: "Close the other tab to use this one." }
    : conn.status.kind === "full" ? { title: "This session is full.", sub: "Ask the stage team." }
    : conn.status.kind === "gave-up" ? { title: "Lost connection.", sub: null }
    : !connected ? { title: "Connecting.", sub: null }
    : holding ? { title: "Hold your phone up.", sub: "Screen facing the stage." }
    : awaitingMap ? { title: "Finding your seat.", sub: "You can lower your phone." }
    : needsSection ? { title: "Where are you sitting?", sub: "Facing the stage." }
    : soundOff ? { title: "Turn on sound.", sub: null }
    : !assetsVerified ? { title: "Getting your music.", sub: "Stay on this page." }
    : channel ? { title: channel.label, sub: playing ? "Volume up." : "Wait for the music to start." }
    : mapped || manual ? { title: section ? `${section} section.` : "You're in place.", sub: "Waiting for your part." }
    : { title: "You're ready.", sub: "Turn your volume up." };

  // Four independent facts, reported separately because they fail separately. A cross means
  // this phone needs something from its owner or the stage team; a spinner means it is still
  // working on its own and no one needs to act.
  const musicFailed = assetNote?.startsWith("Failed:") ?? false;
  const checks: { label: string; state: CheckState }[] = [
    { label: "Connection", state: connected ? "ok" : ["gave-up", "full", "replaced", "reset"].includes(conn.status.kind) ? "fail" : "wait" },
    { label: "Clock", state: clockQuality.ready ? "ok" : "wait" },
    { label: "Music", state: assetsVerified ? "ok" : musicFailed ? "fail" : "wait" },
    { label: "Sound", state: soundReady ? "ok" : soundOff ? "fail" : "wait" },
  ];

  function chooseSection(column: "left" | "center" | "right") {
    const snapshot = connection.current?.current.snapshot;
    if (snapshot) connection.current?.send(ClientMessage.parse({ protocolVersion: 1, sessionId: snapshot.sessionId, serverEpoch: snapshot.serverEpoch,
      messageId: crypto.randomUUID(), type: "participant.column", payload: { column } }));
  }

  return <main className="screen">
    <header className="screen-top">
      <b><Star />Concerto</b>
      {identity && <span>[ {String(identity.deviceId).padStart(3, "0")} ]</span>}
    </header>

    <div className="screen-main">
      <h1 className="say">{say.title}</h1>
      {say.sub && <p className="sub">{say.sub}</p>}
      {channel && !holding && <p className="part-mark"><i style={{ background: channel.color }} />Your part</p>}

      {(needsSection || soundOff || conn.status.kind === "gave-up") && <div className="act">
        {needsSection && <div className="act-row">{(["left", "center", "right"] as const).map(column =>
          <button key={column} onClick={() => chooseSection(column)}>{column}</button>)}</div>}
        {soundOff && !reset && <button className="primary" onClick={() => void enableSound()}>
          {isAudioContextPaused(audioState) ? "Tap to turn on sound" : "Turn on sound"}</button>}
        {conn.status.kind === "gave-up" && <button onClick={() => connection.current?.retry()}>Try again</button>}
      </div>}

      {audioNote && <p role="alert" className="warn">{audioNote}</p>}
      {assetNote?.startsWith("Failed:") && <p role="alert" className="warn">Your music did not finish downloading. Stay on this page.</p>}
      {!foreground && !reset && <p className="warn">Come back to this page to stay ready.</p>}
    </div>

    <footer className="screen-foot">
      {!reset && <Checks items={checks} />}
      {mock && <p className="mock-note">Test session</p>}
    </footer>

    {phase.kind === "armed" && <CalibrationOverlay surface={surface} text={surfaceText} />}
  </main>;
}
