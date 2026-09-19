"use client";
import { useState } from "react";
import { useAdapter } from "../lib/useSnapshot";
import { MapPanel } from "./MapPanel";
import type { AdminSnapshotData } from "@orchestra/contracts";

export function AssignPanel({ snapshot, refresh }: { snapshot: AdminSnapshotData; refresh: () => void }) {
  const adapter = useAdapter();
  const [selected, setSelected] = useState<number[]>([]);
  const [channelId, setChannelId] = useState<string>(snapshot.show.channels[0]?.channelId ?? "");
  const [effectiveDelay, setEffectiveDelay] = useState(3);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ deviceIds: number[]; channelId: string | null } | null>(null);

  function futureMs(delaySeconds: number) {
    // Schedule relative to the server clock; the harness applies when serverMs reaches it.
    return (snapshot.serverMs ?? 0) + delaySeconds * 1000;
  }

  async function assign(channel: string | null, delaySeconds: number, deviceIds: number[]) {
    if (deviceIds.length === 0) { setError("Draw a selection on the map first."); return; }
    setError(null); setStatus(null);
    try {
      // Save a one-step undo of the previous assignment for these devices.
      setUndo({ deviceIds, channelId: snapshot.assignments.find(a => a.deviceId === deviceIds[0])?.channelId ?? null });
      const result = await adapter.sendAssignment({ deviceIds, channelId: channel, mapRevision: snapshot.audienceMap.mapRevision, effectiveServerMs: futureMs(delaySeconds) });
      setStatus(`Sent assignment of ${deviceIds.length} phones to ${channel ?? "(clear)"} — pending. command ${result.commandId.slice(0, 8)}.`);
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("STALE_MAP") ? "The map changed during selection. The snapshot has been refreshed — redraw and try again." : msg);
      refresh();
    }
  }

  async function doUndo() {
    if (!undo) return;
    await assign(undo.channelId, 0, undo.deviceIds);
    setUndo(null);
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
          <input type="number" min={0} value={effectiveDelay} onChange={e => setEffectiveDelay(Number(e.target.value))} /> seconds
        </label>
        <button onClick={() => assign(channelId, effectiveDelay, selected)}>Assign {selected.length} phones</button>
        <button onClick={() => assign(null, effectiveDelay, selected)}>Clear assignment</button>
        <button disabled={!undo} onClick={doUndo}>Undo</button>
      </div>
    </section>
  );
}
