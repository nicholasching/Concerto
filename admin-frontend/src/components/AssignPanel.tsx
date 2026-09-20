"use client";
import { useState } from "react";
import { useAdapter } from "../lib/useSnapshot";
import { MapPanel } from "./MapPanel";
import type { AdminSnapshotData } from "@orchestra/contracts";
import type { DeviceSelection } from "@orchestra/selection";
import { futureServerMs } from "../lib/clock";

export function AssignPanel({ snapshot, refresh }: { snapshot: AdminSnapshotData; refresh: () => Promise<void> }) {
  const adapter = useAdapter();
  const [selected, setSelected] = useState<DeviceSelection | null>(null);
  const [channelId, setChannelId] = useState<string>(snapshot.show.channels[0]?.channelId ?? "");
  const [effectiveDelay, setEffectiveDelay] = useState(2);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Map<string | null, number[]> | null>(null);

  function futureMs(delaySeconds: number) {
    // Schedule relative to the server clock; the harness applies when serverMs reaches it.
    return futureServerMs(delaySeconds);
  }

  async function assign(channel: string | null, delaySeconds: number, selection: DeviceSelection | null, rememberPrevious = true): Promise<boolean> {
    if (!selection || selection.deviceIds.length === 0) { setError("Draw a selection on the map first."); return false; }
    const { deviceIds, mapRevision } = selection;
    setError(null); setStatus(null);
    try {
      // Save a one-step undo of the previous assignment for these devices.
      const previous = new Map<string | null, number[]>();
      for (const deviceId of deviceIds) {
        const prior = snapshot.assignments.find(a => a.deviceId === deviceId)?.channelId ?? null;
        previous.set(prior, [...(previous.get(prior) ?? []), deviceId]);
      }
      if (rememberPrevious) setUndo(previous);
      const result = await adapter.sendAssignment({ deviceIds, channelId: channel, mapRevision, effectiveServerMs: futureMs(delaySeconds) });
      setStatus(`Scheduled ${result.ready ?? deviceIds.length} phones to ${channel ?? "(clear)"}. Excluded: ${result.excluded?.map(item => `${item.deviceId}: ${item.reason}`).join(", ") || "none"}.`);
      await refresh();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("STALE_MAP") ? "The map changed during selection. The snapshot has been refreshed — redraw and try again." : msg);
      await refresh();
      return false;
    }
  }

  async function doUndo() {
    if (!undo || !selected) return;
    const remaining = new Map<string | null, number[]>();
    for (const [channelId, deviceIds] of undo) {
      if (!await assign(channelId, effectiveDelay, { ...selected, deviceIds }, false)) remaining.set(channelId, deviceIds);
    }
    setUndo(remaining.size === 0 ? null : remaining);
  }

  const channelColor = snapshot.show.channels.find(c => c.channelId === channelId)?.color ?? "#888";

  return (
    <section>
      <div className="stage-heading"><span className="stage-number">02</span><div><p className="eyebrow">GIVE EVERY PHONE A PART</p><h2>Assign the audience</h2></div><span className="stage-badge">{snapshot.assignments.filter(item => item.channelId).length} assigned</span></div>
      <p className="muted">Draw a group on the map, choose its musical part, then assign. White outlines show your selection.</p>
      {error && <p role="alert" className="error">Error: {error}</p>}
      {status && <p className="status">{status}</p>}
      <MapPanel
        map={snapshot.audienceMap}
        assignments={snapshot.assignments}
        channels={snapshot.show.channels}
        drawable
        selection={selected}
        onSelection={setSelected}
      />
      <div className="actions">{(["left", "center", "right"] as const).map(column => <button key={column} onClick={() => setSelected({ mapRevision: snapshot.audienceMap.mapRevision,
        deviceIds: snapshot.audienceMap.locations.filter(location => location.column === column && (location.status === "localized" || location.status === "coarse")).map(location => location.deviceId) })}>Select {column} column (includes manual choices)</button>)}</div>
      <details><summary>Phones without a full position</summary>{snapshot.audienceMap.locations.filter(location => location.status !== "localized").map(location => <label key={location.deviceId} style={{ display: "block" }}>
        <input type="checkbox" checked={selected?.deviceIds.includes(location.deviceId) ?? false} onChange={e => setSelected({ mapRevision: snapshot.audienceMap.mapRevision,
          deviceIds: e.target.checked ? [...new Set([...(selected?.deviceIds ?? []), location.deviceId])] : (selected?.deviceIds ?? []).filter(id => id !== location.deviceId) })} />
        Device {location.deviceId}: {location.column ?? "unknown column"} · {location.status} · {location.mappingMode}
      </label>)}</details>
      <p>Selection: {selected?.deviceIds.length ?? 0} phones, map revision {selected?.mapRevision ?? "—"}. {selected && selected.mapRevision !== snapshot.audienceMap.mapRevision && "Map changed: select again."}</p>
      <div className="actions">
        <div className="channel-picker" role="group" aria-label="Musical part">{snapshot.show.channels.map(ch => <button key={ch.channelId} aria-pressed={ch.channelId === channelId} className={ch.channelId === channelId ? "chosen" : ""} style={{ borderColor: ch.channelId === channelId ? channelColor : undefined }} onClick={() => setChannelId(ch.channelId)}><span className="swatch" style={{ background: ch.color }} />{ch.label}</button>)}</div>
        <label>Apply in
        <input type="number" min={2} value={effectiveDelay} onChange={e => setEffectiveDelay(Math.max(2, Number(e.target.value)))} /> seconds after preparation
        </label>
        <button className="primary large" disabled={!selected?.deviceIds.length || selected.mapRevision !== snapshot.audienceMap.mapRevision} onClick={() => assign(channelId, effectiveDelay, selected)}>Assign {selected?.deviceIds.length ?? 0} phones</button>
        <button onClick={() => assign(null, effectiveDelay, selected)}>Clear assignment</button>
        <button disabled={!undo} onClick={doUndo}>Undo</button>
      </div>
    </section>
  );
}
