import { DECODED_AUDIO_BUDGET_BYTES, type ShowData } from "@orchestra/contracts";

export type TrackData = ShowData["tracks"][number];
export const DEFAULT_DECODED_BUDGET_BYTES = DECODED_AUDIO_BUDGET_BYTES;

export class AssetError extends Error {
  constructor(readonly code: "http" | "size" | "hash" | "budget" | "timeout", message: string,
    readonly retryable = false, readonly retryAfterMs = 0) {
    super(message);
  }
}

export interface LoadedTrack {
  trackId: string;
  sha256: string;
  buffer: AudioBuffer;
  decodedBytes: number;
}

/** Decoded float32 PCM held by the browser for one buffer. */
export const decodedBytes = (buffer: Pick<AudioBuffer, "length" | "numberOfChannels">) => buffer.length * buffer.numberOfChannels * 4;

// Replaces BeatSync's three-buffer LRU: budget by decoded bytes instead of count.
export class DecodedBudget {
  private readonly used = new Map<string, number>();
  constructor(readonly limitBytes = DEFAULT_DECODED_BUDGET_BYTES) {}

  get usedBytes(): number {
    let total = 0;
    for (const bytes of this.used.values()) total += bytes;
    return total;
  }

  reserve(trackId: string, bytes: number): void {
    const others = this.usedBytes - (this.used.get(trackId) ?? 0);
    if (others + bytes > this.limitBytes) throw new AssetError("budget", `${trackId} needs ${bytes} decoded bytes; ${this.limitBytes - others} available`);
    this.used.set(trackId, bytes);
  }

  release(trackId: string): void {
    this.used.delete(trackId);
  }
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

export interface LoadTrackOptions {
  ctx: Pick<BaseAudioContext, "decodeAudioData">;
  budget: DecodedBudget;
  baseUrl: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
  random?: () => number;
  timeoutMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export const DOWNLOAD_POLICY = { attempts: 4, concurrency: 2, idleTimeoutMs: 30000, cooldownMs: 60000, maxRetryAfterMs: 60000 } as const;

const abortError = () => new DOMException("Music loading cancelled", "AbortError");
const sleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(abortError()); return; }
  const aborted = () => { clearTimeout(timer); reject(abortError()); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, ms);
  signal.addEventListener("abort", aborted, { once: true });
});

// Inactivity rather than total-transfer timeout: a slow but progressing stem may take minutes.
async function download(track: TrackData, options: LoadTrackOptions): Promise<ArrayBuffer> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let fail!: (error: unknown) => void;
  const cancelled = new Promise<never>((_, reject) => { fail = reject; });
  const abort = () => { fail(abortError()); controller.abort(); void reader?.cancel().catch(() => {}); };
  const resetTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fail(new AssetError("timeout", `${track.trackId}: download stopped responding`, true));
      controller.abort(); void reader?.cancel().catch(() => {});
    }, options.timeoutMs ?? DOWNLOAD_POLICY.idleTimeoutMs);
  };
  if (options.signal?.aborted) throw abortError();
  options.signal?.addEventListener("abort", abort, { once: true });
  resetTimeout();
  try {
    return await Promise.race([cancelled, (async () => {
      const response = await (options.fetch ?? fetch)(new URL(track.url, options.baseUrl).toString(), { signal: controller.signal });
      if (controller.signal.aborted) throw abortError();
      resetTimeout();
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const header = response.headers.get("retry-after");
        const delay = header ? (/^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 0;
        throw new AssetError("http", `${track.trackId}: HTTP ${response.status}`,
          response.status === 408 || response.status === 429 || response.status >= 500,
          Math.max(0, Math.min(DOWNLOAD_POLICY.maxRetryAfterMs, Number.isFinite(delay) ? delay : 0)));
      }
      if (!response.body) throw new AssetError("size", `${track.trackId}: empty response`, true);
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        if (controller.signal.aborted) throw abortError();
        resetTimeout();
        size += part.value.byteLength;
        if (size > track.byteSize) { await reader.cancel(); throw new AssetError("size", `${track.trackId}: response exceeds declared size`); }
        chunks.push(part.value);
      }
      if (controller.signal.aborted) throw abortError();
      if (size !== track.byteSize) throw new AssetError("size", `${track.trackId}: expected ${track.byteSize} bytes, got ${size}`, true);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes.buffer;
    })()]);
  } finally {
    clearTimeout(timer!);
    options.signal?.removeEventListener("abort", abort);
  }
}

// A track is ready only when its bytes match the show's size and hash and it decodes.
export async function loadTrack(track: TrackData, options: LoadTrackOptions): Promise<LoadedTrack> {
  const signal = options.signal ?? new AbortController().signal;
  const random = options.random ?? Math.random;
  let bytes!: ArrayBuffer;
  for (let attempt = 0; attempt < DOWNLOAD_POLICY.attempts; attempt++) {
    if (signal.aborted) throw abortError();
    try { bytes = await download(track, { ...options, signal }); break; }
    catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      if ((error instanceof AssetError && !error.retryable) || attempt === DOWNLOAD_POLICY.attempts - 1) throw error;
      const retryAfter = error instanceof AssetError ? error.retryAfterMs : 0;
      await (options.sleep ?? sleep)(Math.max(retryAfter, 2000 * 2 ** attempt) + random() * 2000, signal);
    }
  }
  if (signal.aborted) throw abortError();
  if (bytes.byteLength !== track.byteSize) throw new AssetError("size", `${track.trackId}: expected ${track.byteSize} bytes, got ${bytes.byteLength}`);
  const hash = await sha256Hex(bytes);
  if (hash !== track.sha256) throw new AssetError("hash", `${track.trackId}: sha256 ${hash} does not match ${track.sha256}`);
  const buffer = await options.ctx.decodeAudioData(bytes);
  if (signal.aborted) throw abortError();
  const size = decodedBytes(buffer);
  options.budget.reserve(track.trackId, size);
  return { trackId: track.trackId, sha256: track.sha256, buffer, decodedBytes: size };
}

export interface PreloadFailure { trackId: string; message: string }
interface LoadEntry { promise: Promise<LoadedTrack>; controller: AbortController; failedAt?: number }
interface LoadQueue { entries: Map<string, LoadEntry>; active: number; waiting: (() => void)[] }
const pendingLoads = new WeakMap<Map<string, LoadedTrack>, LoadQueue>();

export function cancelPreloads(cache: Map<string, LoadedTrack>): void {
  const queue = pendingLoads.get(cache);
  if (!queue) return;
  for (const entry of queue.entries.values()) entry.controller.abort();
  queue.entries.clear();
}

// Loads every track not already cached with the same hash. One bad track does not
// block the others; only verified tracks enter the cache.
export async function preloadTracks(tracks: TrackData[], options: LoadTrackOptions, cache: Map<string, LoadedTrack>): Promise<PreloadFailure[]> {
  const missing = tracks.filter(track => cache.get(track.trackId)?.sha256 !== track.sha256);
  let queue = pendingLoads.get(cache);
  if (!queue) { queue = { entries: new Map(), active: 0, waiting: [] }; pendingLoads.set(cache, queue); }
  const pending = queue.entries;
  const wanted = new Set(tracks.map(track => `${track.trackId}:${track.sha256}`));
  for (const [key, entry] of pending) if (!wanted.has(key)) { entry.controller.abort(); pending.delete(key); }
  // Automatic preload and a later audio gesture can overlap. Share the decode so a phone
  // never allocates a second copy of the show simply because its context became running.
  const results = await Promise.allSettled(missing.map(track => {
    const key = `${track.trackId}:${track.sha256}`;
    let entry = pending.get(key);
    if (entry?.failedAt !== undefined && Date.now() - entry.failedAt >= DOWNLOAD_POLICY.cooldownMs) { pending.delete(key); entry = undefined; }
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, promise: Promise.resolve(null as unknown as LoadedTrack) };
      const current = entry, scheduler = queue;
      current.promise = (async () => {
        if (scheduler.active >= DOWNLOAD_POLICY.concurrency) await new Promise<void>(resolve => scheduler.waiting.push(resolve));
        else scheduler.active++;
        try {
          const loaded = await loadTrack(track, { ...options, signal: controller.signal });
          if (!controller.signal.aborted) cache.set(track.trackId, loaded);
          return loaded;
        } finally { const next = scheduler.waiting.shift(); if (next) next(); else scheduler.active--; }
      })().catch(error => { current.failedAt = Date.now(); throw error; });
      pending.set(key, current);
    }
    return entry.promise;
  }));
  const failures: PreloadFailure[] = [];
  results.forEach((result, index) => {
    const trackId = missing[index].trackId;
    if (result.status === "rejected") failures.push({ trackId, message: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });
  return failures;
}
