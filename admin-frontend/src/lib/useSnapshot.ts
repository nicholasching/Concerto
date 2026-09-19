"use client";
import { useCallback, useEffect, useState } from "react";
import { createAdapter } from "./adapter";
import { syncFromServerMs } from "./clock";
import type { AdminSnapshotData } from "@orchestra/contracts";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// One adapter instance for the whole console so pending state is shared across screens.
const adapter = createAdapter(api);
export const useAdapter = () => adapter;

export interface SnapshotState {
  snapshot: AdminSnapshotData | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

// Polls the snapshot through the adapter and keeps the console clock synced to the server's ms.
export function useSnapshot(intervalMs = 1000): SnapshotState {
  const [snapshot, setSnapshot] = useState<AdminSnapshotData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0); // bump to force a re-render after pending changes

  const refresh = useCallback(async () => {
    try {
      const data = await adapter.getSnapshot();
      syncFromServerMs(data.serverMs);
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs, tick]);

  // Re-render-friendly refresh that also bumps pending state.
  const forceRefresh = useCallback(async () => { setTick(t => t + 1); await refresh(); }, [refresh]);
  return { snapshot, error, loading, refresh: forceRefresh };
}
