import { DECODED_AUDIO_BUDGET_BYTES, type ShowData } from "@orchestra/contracts";

export type TrackData = ShowData["tracks"][number];
export const DEFAULT_DECODED_BUDGET_BYTES = DECODED_AUDIO_BUDGET_BYTES;

export class AssetError extends Error {
  constructor(readonly code: "http" | "size" | "hash" | "budget", message: string) {
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
  fetch?: (url: string) => Promise<Response>;
}

// A track is ready only when its bytes match the show's size and hash and it decodes.
export async function loadTrack(track: TrackData, { ctx, budget, baseUrl, fetch: get = fetch }: LoadTrackOptions): Promise<LoadedTrack> {
  const response = await get(new URL(track.url, baseUrl).toString());
  if (!response.ok) throw new AssetError("http", `${track.trackId}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== track.byteSize) throw new AssetError("size", `${track.trackId}: expected ${track.byteSize} bytes, got ${bytes.byteLength}`);
  const hash = await sha256Hex(bytes);
  if (hash !== track.sha256) throw new AssetError("hash", `${track.trackId}: sha256 ${hash} does not match ${track.sha256}`);
  const buffer = await ctx.decodeAudioData(bytes);
  const size = decodedBytes(buffer);
  budget.reserve(track.trackId, size);
  return { trackId: track.trackId, sha256: track.sha256, buffer, decodedBytes: size };
}

export interface PreloadFailure { trackId: string; message: string }

// Loads every track not already cached with the same hash. One bad track does not
// block the others; only verified tracks enter the cache.
export async function preloadTracks(tracks: TrackData[], options: LoadTrackOptions, cache: Map<string, LoadedTrack>): Promise<PreloadFailure[]> {
  const missing = tracks.filter(track => cache.get(track.trackId)?.sha256 !== track.sha256);
  const results = await Promise.allSettled(missing.map(track => loadTrack(track, options)));
  const failures: PreloadFailure[] = [];
  results.forEach((result, index) => {
    const trackId = missing[index].trackId;
    if (result.status === "fulfilled") cache.set(trackId, result.value);
    else failures.push({ trackId, message: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });
  return failures;
}
