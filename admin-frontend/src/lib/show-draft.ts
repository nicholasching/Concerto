import { Show, type ShowData } from "@orchestra/contracts";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const key = (sessionId: string) => `orchestra.show-draft.v1.${sessionId}`;

function browserStorage(): DraftStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.sessionStorage; }
  catch { return undefined; }
}

export function rememberShowDraft(sessionId: string, saved: ShowData, draft: ShowData, storage = browserStorage()) {
  try { storage?.setItem(key(sessionId), JSON.stringify({ showId: saved.showId, revision: saved.showRevision, draft })); }
  catch { /* Editing still works if the browser cannot store a recovery copy. */ }
}

export function recoverShowDraft(sessionId: string, saved: ShowData, storage = browserStorage()): ShowData | null {
  try {
    const raw = storage?.getItem(key(sessionId));
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (stored.showId !== saved.showId || stored.revision !== saved.showRevision) {
      storage?.removeItem(key(sessionId));
      return null;
    }
    const parsed = Show.safeParse(stored.draft);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export function forgetShowDraft(sessionId: string, storage = browserStorage()) {
  try { storage?.removeItem(key(sessionId)); }
  catch { /* Saving the show does not depend on browser storage availability. */ }
}
