import { ApiError, JoinResponse } from "@orchestra/contracts";

export type JoinData = ReturnType<typeof JoinResponse.parse>;
export type JoinResult =
  | { status: "joined"; join: JoinData; newDevice: boolean; tokenRejected: boolean }
  | { status: "full" }
  | { status: "error"; message: string };

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface JoinOptions {
  api: string;
  sessionId: string;
  storage: KeyValueStore;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export const tokenKey = (sessionId: string) => `orchestra:resume:${sessionId}`;
export const JOIN_TIMEOUT_MS = 10000;

// Concurrent callers for one session share a request, so a double mount can't burn two IDs.
const pending = new Map<string, Promise<JoinResult>>();

export function joinSession(options: JoinOptions): Promise<JoinResult> {
  const key = `${options.api}|${options.sessionId}`;
  let request = pending.get(key);
  if (!request) {
    request = attemptJoin(options).finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return request;
}

async function attemptJoin({ api, sessionId, storage, fetch: post = fetch }: JoinOptions): Promise<JoinResult> {
  const saved = read(storage, tokenKey(sessionId));
  const url = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/join`, api).toString();
  const controller = new AbortController();
  // An unreachable tunnel can leave fetch pending and block every subsequent retry.
  const timeout = setTimeout(() => controller.abort(), JOIN_TIMEOUT_MS);
  const send = (resumeToken: string | null) => post(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resumeToken ? { resumeToken } : {}),
    signal: controller.signal,
  });
  try {
    let response = await send(saved);
    let tokenRejected = false;
    if (response.status === 401 && saved) {
      // The server no longer knows this identity. Never guess an ID; join as a new device.
      remove(storage, tokenKey(sessionId));
      tokenRejected = true;
      response = await send(null);
    }
    if (response.status === 409 || response.status === 503) {
      const error = ApiError.safeParse(await response.clone().json().catch(() => null));
      if (error.success && ["SESSION_FULL", "CAPACITY_REACHED"].includes(error.data.error.code)) return { status: "full" };
    }
    if (!response.ok) return { status: "error", message: await errorMessage(response) };
    const join = JoinResponse.parse(await response.json());
    if (join.sessionId !== sessionId) return { status: "error", message: `Joined session ${join.sessionId}, expected ${sessionId}` };
    write(storage, tokenKey(sessionId), join.resumeToken);
    return { status: "joined", join, newDevice: !saved || tokenRejected, tokenRejected };
  } catch (error) {
    return { status: "error", message: controller.signal.aborted ? "Join timed out; retrying the connection." : error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function errorMessage(response: Response): Promise<string> {
  const parsed = ApiError.safeParse(await response.json().catch(() => null));
  return parsed.success ? `${parsed.data.error.code}: ${parsed.data.error.message}` : `HTTP ${response.status}`;
}

// Storage can throw in private mode; identity then lasts only for this page load.
function read(storage: KeyValueStore, key: string) { try { return storage.getItem(key); } catch { return null; } }
function write(storage: KeyValueStore, key: string, value: string) { try { storage.setItem(key, value); } catch { /* not persisted */ } }
function remove(storage: KeyValueStore, key: string) { try { storage.removeItem(key); } catch { /* not persisted */ } }

export function browserStorage(): KeyValueStore {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch { /* fall through */ }
  const memory = new Map<string, string>();
  return { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); }, removeItem: key => { memory.delete(key); } };
}
