"use client";
import { useState } from "react";
import { useAdapter } from "../lib/useSnapshot";
import { MapPanel } from "./MapPanel";
import type { AdminSnapshotData } from "@orchestra/contracts";
import type { DeviceSelection } from "@orchestra/selection";
import { nowServerMs } from "../lib/clock";

export function AssignPanel({ snapshot, refresh }: { snapshot: AdminSnapshotData; refresh: () => Promise<void> }) {
  const adapter = useAdapter();
  const [selected, setSelected] = useState<DeviceSelection | null>(null);
  const [channelId, setChannelId] = useState<string>(snapshot.show.channels[0]?.channelId ?? "");
  const [effectiveDelay, setEffectiveDelay] = useState(3);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Map<string | null, number[]> | null>(null);

  function futureMs(delaySeconds: number) {
    // Schedule relative to the server clock; the harness applies when serverMs reaches it.
    return nowServerMs() + Math.max(3, delaySeconds) * 1000;
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
      setStatus(`Sent assignment of ${deviceIds.length} phones to ${channel ?? "(clear)"} — pending. command ${result.commandId.slice(0, 8)}.`);
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
      <div className="actions">
        <label>Channel
          <select value={channelId} onChange={e => setChannelId(e.target.value)}>
            {snapshot.show.channels.map(ch => <option key={ch.channelId} value={ch.channelId}>{ch.label}</option>)}
          </select>
        </label>
        <span className="swatch" style={{ background: channelColor }} />
        <label>Apply in
        <input type="number" min={3} value={effectiveDelay} onChange={e => setEffectiveDelay(Math.max(3, Number(e.target.value)))} /> seconds
        </label>
        <button onClick={() => assign(channelId, effectiveDelay, selected)}>Assign {selected?.deviceIds.length ?? 0} phones</button>
        <button onClick={() => assign(null, effectiveDelay, selected)}>Clear assignment</button>
        <button disabled={!undo} onClick={doUndo}>Undo</button>
      </div>
    </section>
  );
}
