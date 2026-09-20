import type { FrameScheduler } from "./flash-renderer";
import { FLOOR } from "./level-meter";
import type { PlaybackView } from "./show-control";

interface Meter { read(elapsedMs: number): number; dispose(): void }
interface MusicVisualizerOptions {
  playback: () => PlaybackView | undefined;
  color: (channelId: string) => string | undefined;
  createMeter: () => Meter;
  frames: FrameScheduler;
  /** Local elapsed time for smoothing only. ShowControl owns scheduled server time. */
  now: () => number;
  /** Null color restores the normal audience UI. */
  paint: (color: string | null, brightness: number) => void;
}

// The same effective state that schedules audio drives the surface, even between snapshots.
export class MusicVisualizer {
  private handle: unknown = null;
  private meter: Meter | null = null;
  private channelId: string | null = null;
  private lastFrameMs: number | null = null;
  private stopped = false;

  constructor(private readonly options: MusicVisualizerOptions) {}

  start(): void { this.schedule(); }

  stop(): void {
    this.stopped = true;
    if (this.handle !== null) this.options.frames.cancel(this.handle);
    this.handle = null;
    this.clear();
  }

  private clear(): void {
    this.meter?.dispose();
    this.meter = null;
    this.channelId = null;
    this.lastFrameMs = null;
    this.options.paint(null, FLOOR);
  }

  private schedule(): void {
    this.handle = this.options.frames.request(() => {
      this.handle = null;
      if (this.stopped) return;
      const view = this.options.playback();
      const channelId = view?.channelId ?? null;
      const color = view?.transport?.status === "playing" && !view.panicked && channelId !== null
        ? this.options.color(channelId) : undefined;
      if (!color) this.clear();
      else {
        if (channelId !== this.channelId) this.clear();
        this.channelId = channelId;
        this.meter ??= this.options.createMeter();
        const now = this.options.now();
        const elapsed = this.lastFrameMs === null ? 1000 / 60 : now - this.lastFrameMs;
        this.lastFrameMs = now;
        this.options.paint(color, this.meter.read(elapsed));
      }
      this.schedule();
    });
  }
}
