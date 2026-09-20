"use client";
import { useCallback, useEffect, useState } from "react";
import { createAdapter } from "./adapter";
import { connectClock } from "./clock";
import type { AdminSnapshotData } from "@orchestra/contracts";

export const api = process.env.NEXT_PUBLIC_API_URL ?? (typeof window === "undefined" ? "http://localhost:3000/control" : `${window.location.origin}/control`);

// One adapter instance for the whole console so pending state is shared across screens.
const adapter = createAdapter(api);
export const useAdapter = () => adapter;

export interface SnapshotState {
  snapshot: AdminSnapshotData | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (secret: string) => Promise<void>;
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
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (secret: string) => {
    const info = await adapter.discoverSession();
    adapter.configure(secret, info.sessionId);
    await adapter.getSnapshot();
    try { sessionStorage.setItem("orchestra:operator", secret); } catch { /* page-only access */ }
    connectClock(adapter.socketUrl());
    await refresh();
  }, [refresh]);

  useEffect(() => {
    try { const secret = sessionStorage.getItem("orchestra:operator"); if (secret) void login(secret).catch(err => setError(String(err))); } catch { /* no storage */ }
  }, [login]);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs, tick]);

  // Re-render-friendly refresh that also bumps pending state.
  const forceRefresh = useCallback(async () => { setTick(t => t + 1); await refresh(); }, [refresh]);
  return { snapshot, error, loading, refresh: forceRefresh, login };
}
