import type { Timers } from "./connection";

export const UNLOCK_TIMEOUT_MS = 4000;
export type UnlockOutcome = { kind: "running" } | { kind: "timeout" } | { kind: "error"; message: string };

// A browser that doesn't accept the tap as a gesture leaves resume() pending forever.
// Give the user feedback instead of a silent page; a later tap can still succeed.
export async function unlockWithin(unlock: () => Promise<void>, timers: Timers, ms = UNLOCK_TIMEOUT_MS): Promise<UnlockOutcome> {
  let handle: unknown = null;
  const timeout = new Promise<UnlockOutcome>(resolve => { handle = timers.setTimeout(() => resolve({ kind: "timeout" }), ms); });
  try {
    return await Promise.race([unlock().then((): UnlockOutcome => ({ kind: "running" })), timeout]);
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  } finally {
    timers.clearTimeout(handle);
  }
}
