// Adapted from BeatSync apps/client/src/lib/audioContextManager.ts (MIT).
// See THIRD_PARTY_NOTICES.md and .devcontext/beat-sync-extraction.md.

/** iOS 18+ uses a non-standard "interrupted" state (e.g. phone call, Siri). */
export function isAudioContextPaused(state: string | null | undefined): boolean {
  return state === "suspended" || state === "interrupted";
}

// One AudioContext per page. iOS limits how many a page may create.
export class AudioContextHost {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private visibilityListener: (() => void) | null = null;
  private readonly listeners = new Set<(state: string) => void>();

  constructor(private readonly create: () => AudioContext = () => new AudioContext()) {}

  context(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      const ctx = this.create();
      this.gain = ctx.createGain();
      this.gain.connect(ctx.destination);
      ctx.onstatechange = () => { for (const listener of this.listeners) listener(ctx.state); };
      this.ctx = ctx;
    }
    return this.ctx;
  }

  get masterGain(): GainNode {
    this.context();
    return this.gain!;
  }

  get state(): string | null {
    return this.ctx?.state ?? null;
  }

  onStateChange(listener: (state: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Call from a user gesture handler. Resolves only once the context is running. */
  async unlock(): Promise<void> {
    setPlaybackAudioSession();
    const ctx = this.context();
    if (isAudioContextPaused(ctx.state)) await ctx.resume();
    if (ctx.state !== "running") throw new Error(`AudioContext is ${ctx.state} after unlock`);
    await this.requestWakeLock();
  }

  async dispose(): Promise<void> {
    if (this.visibilityListener) document.removeEventListener("visibilitychange", this.visibilityListener);
    this.visibilityListener = null;
    await this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.gain = null;
    if (ctx && ctx.state !== "closed") await ctx.close();
  }

  // Best effort: keeps the screen on and avoids Wi-Fi power-save delays.
  private async requestWakeLock(): Promise<void> {
    if (this.wakeLock || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
      this.wakeLock.addEventListener("release", () => { this.wakeLock = null; });
    } catch {
      return;
    }
    if (!this.visibilityListener && typeof document !== "undefined") {
      this.visibilityListener = () => { if (document.visibilityState === "visible") void this.requestWakeLock(); };
      document.addEventListener("visibilitychange", this.visibilityListener);
    }
  }
}

// iOS 16.4+: the "playback" session lets Web Audio play with the ring/silent switch on silent.
// Adapted from BeatSync apps/client/src/store/global.tsx (MIT).
export function setPlaybackAudioSession(nav: unknown = typeof navigator === "undefined" ? undefined : navigator): boolean {
  const session = (nav as { audioSession?: { type: string } } | undefined)?.audioSession;
  if (!session) return false;
  session.type = "playback";
  return true;
}
