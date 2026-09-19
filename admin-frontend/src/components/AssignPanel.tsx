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
  const [effectiveDelay, setEffectiveDelay] = useState(4);
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
      <h2>Assign</h2>
      <p className="muted">Draw a box on the map to select phones, assign them to a channel, and schedule the change. Unknowns (coarse/unseen) stay out of the selection. Undo restores the previous assignment for the selected devices.</p>
      {error && <p role="alert" className="error">Error: {error}</p>}
      {status && <p className="status">{status}</p>}
      <MapPanel
        map={snapshot.audienceMap}
        assignments={snapshot.assignments}
        channels={snapshot.show.channels}
        drawable
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
        <label>Channel
          <select value={channelId} onChange={e => setChannelId(e.target.value)}>
            {snapshot.show.channels.map(ch => <option key={ch.channelId} value={ch.channelId}>{ch.label}</option>)}
          </select>
        </label>
        <span className="swatch" style={{ background: channelColor }} />
        <label>Apply in
        <input type="number" min={4} value={effectiveDelay} onChange={e => setEffectiveDelay(Math.max(4, Number(e.target.value)))} /> seconds after preparation
        </label>
        <button onClick={() => assign(channelId, effectiveDelay, selected)}>Assign {selected?.deviceIds.length ?? 0} phones</button>
        <button onClick={() => assign(null, effectiveDelay, selected)}>Clear assignment</button>
        <button disabled={!undo} onClick={doUndo}>Undo</button>
      </div>
    </section>
  );
}
