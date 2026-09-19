import type { SynchronizedClock } from "@orchestra/sync";
import type { OpticalSymbol } from "@orchestra/contracts/otc";
import { slotAt, symbolColor, type CalibrationRunData } from "./calibration";

export const COUNTDOWN_HIDE_MS = 1000;

export interface FrameScheduler {
  request(callback: () => void): unknown;
  cancel(handle: unknown): void;
}

export interface FlashRendererOptions {
  clock: SynchronizedClock;
  clockUsable: () => boolean;
  run: CalibrationRunData;
  packet: OpticalSymbol[];
  frames: FrameScheduler;
  /** Paints the full-screen colour and optional countdown text. Called once per frame; no React state. */
  paint: (color: string, text: string | null) => void;
  onDone: (maxFrameLatenessMs: number) => void;
  onClockLost: () => void;
}

// Draws the packet from the pure server clock only. No audio clock, output latency or nudge.
export class FlashRenderer {
  private handle: unknown = null;
  private lastSlot = -1;
  private maxLatenessMs = 0;
  private stopped = false;

  constructor(private readonly options: FlashRendererOptions) {}

  start(): void { this.schedule(); }

  stop(): void {
    this.stopped = true;
    if (this.handle !== null) this.options.frames.cancel(this.handle);
    this.handle = null;
  }

  private schedule(): void {
    this.handle = this.options.frames.request(() => { this.handle = null; this.frame(); });
  }

  private frame(): void {
    if (this.stopped) return;
    const { clock, run, packet, paint } = this.options;
    if (!this.options.clockUsable()) { this.stop(); this.options.onClockLost(); return; }
    const now = clock.nowServerMs();
    const slot = slotAt(now, run.startServerMs, run.symbolMs);
    if (slot < 0) {
      const remainingMs = run.startServerMs - now;
      paint(run.palette.neutral, remainingMs > COUNTDOWN_HIDE_MS ? `Hold your phone up, screen toward the stage cameras. Starting in ${Math.ceil(remainingMs / 1000)}` : null);
    } else if (slot >= packet.length) {
      paint(run.palette.neutral, null);
      this.stop();
      this.options.onDone(this.maxLatenessMs);
      return;
    } else {
      if (slot !== this.lastSlot) {
        // Lateness of the first transition this frame should have shown, so skipped slots count too.
        const expectedMs = run.startServerMs + Math.max(this.lastSlot + 1, 0) * run.symbolMs;
        this.maxLatenessMs = Math.max(this.maxLatenessMs, now - expectedMs);
        this.lastSlot = slot;
      }
      paint(symbolColor(packet[slot], run.palette), null);
    }
    this.schedule();
  }
}
