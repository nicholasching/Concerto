/** Brightness at silence. A resting part still reads as a lit phone, not a dead one. */
export const FLOOR = 0.1;
const ATTACK = 0.6;
const RELEASE = 0.12;
// Per frame. The reference peak forgets a loud passage over a few seconds.
const PEAK_DECAY = 0.9995;
// Keeps near-silence from being amplified to full brightness by the rolling peak.
const MIN_PEAK = 0.02;
const CURVE = 0.6;

export interface LevelSource {
  createAnalyser(): AnalyserNode;
}

// Reads the phone's own part off the live audio graph; no amplitude data exists server side.
// One instance per playback run. Read once per animation frame.
export class LevelMeter {
  private readonly analyser: AnalyserNode;
  private readonly samples: Uint8Array<ArrayBuffer>;
  private peak = MIN_PEAK;
  private level = 0;

  constructor(ctx: LevelSource, private readonly source: AudioNode) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.samples = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    this.source.connect(this.analyser);
  }

  /** Smoothed 0..1 brightness, never below FLOOR. */
  read(): number {
    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0;
    for (const sample of this.samples) {
      const value = (sample - 128) / 128;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / this.samples.length);
    // Auto-gain, so a quiet stem pulses as visibly as a loud one.
    this.peak = Math.max(rms, this.peak * PEAK_DECAY, MIN_PEAK);
    const target = Math.pow(Math.min(1, rms / this.peak), CURVE);
    // Fast attack, slow release: transients snap, decays stay smooth.
    this.level += (target - this.level) * (target > this.level ? ATTACK : RELEASE);
    return FLOOR + (1 - FLOOR) * this.level;
  }

  dispose(): void {
    // disconnect() on the analyser only drops its outgoing edges; the master gain
    // would keep feeding it across reconnects.
    this.source.disconnect(this.analyser);
    this.analyser.disconnect();
  }
}
