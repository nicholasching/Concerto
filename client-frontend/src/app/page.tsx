"use client";
import { useEffect, useRef, useState } from "react";
import { AudioContextHost, DecodedBudget, isAudioContextPaused, preloadTracks, type LoadedTrack } from "@orchestra/audio";
import { browserSocket, ParticipantConnection, type ConnectionState } from "../lib/connection";
import { browserStorage, joinSession } from "../lib/join";
import { buildReadiness, statusMessage, StatusReporter } from "../lib/readiness";
import { participantStatus } from "../lib/status";
import { AudioDemo } from "./audio-demo";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";
const sessionId = process.env.NEXT_PUBLIC_SESSION_ID ?? "demo";
const mock = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "1";
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

  useEffect(() => {
    const client = new ParticipantConnection({
      wsUrl,
      join: () => joinSession({ api, sessionId, storage: browserStorage() }),
      openSocket: browserSocket,
      onChange: setConn,
      timers,
    });
    connection.current = client;
    const onVisibility = () => {
      const visible = document.visibilityState === "visible";
      setForeground(visible);
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

  async function enableSound() {
    if (!host.current) {
      host.current = new AudioContextHost();
      host.current.onStateChange(setAudioState);
    }
    try {
      await host.current.unlock();
    } catch (error) {
      setAssetNote(`Audio failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  const firstTrack = tracks[0];

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
      {assetNote && <p>{assetNote}</p>}
    </section>
    {mock && host.current && firstTrack && <AudioDemo host={host.current} trackId={firstTrack.trackId} buffer={cache.current.get(firstTrack.trackId)?.buffer ?? null} />}
  </main>;
}
