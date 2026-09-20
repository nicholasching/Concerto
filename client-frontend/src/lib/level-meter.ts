/** Brightness at silence. A resting part still reads as a lit phone, not a dead one. */
export const FLOOR = 0.1;
const ATTACK = 0.6;
const RELEASE = 0.12;
// Coefficients at 60 Hz; elapsed-time scaling keeps different phone refresh rates consistent.
const PEAK_DECAY = 0.9995;
// Keeps near-silence from being amplified to full brightness by the rolling peak.
const MIN_PEAK = 0.02;
const CURVE = 0.6;
// AudioContextHost keeps a 0.0001-amplitude oscillator running even when music is silent.
const SILENCE_THRESHOLD = 0.0002;

export interface LevelSource {
  createAnalyser(): AnalyserNode;
}

// Reads the phone's own part off the live audio graph; no amplitude data exists server side.
// One instance per playback run. Read once per animation frame.
export class LevelMeter {
  private readonly analyser: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;
  private peak = MIN_PEAK;
  private level = 0;

  constructor(ctx: LevelSource, private readonly source: AudioNode) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.samples = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.analyser);
  }

  /** Smoothed 0..1 brightness, never below FLOOR. */
  read(elapsedMs = 1000 / 60): number {
    // Byte quantization magnifies tiny negative keepalive samples into visible false energy.
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const sample of this.samples) {
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / this.samples.length);
    // Auto-gain, so a quiet stem pulses as visibly as a loud one.
    const frames = Math.max(0, elapsedMs) / (1000 / 60);
    this.peak = Math.max(rms, this.peak * Math.pow(PEAK_DECAY, frames), MIN_PEAK);
    const target = rms <= SILENCE_THRESHOLD ? 0 : Math.pow(Math.min(1, rms / this.peak), CURVE);
    // Fast attack, slow release: transients snap, decays stay smooth.
    const smoothing = 1 - Math.pow(1 - (target > this.level ? ATTACK : RELEASE), frames);
    this.level += (target - this.level) * smoothing;
    return FLOOR + (1 - FLOOR) * this.level;
  }

  dispose(): void {
    // disconnect() on the analyser only drops its outgoing edges; the master gain
    // would keep feeding it across reconnects.
    this.source.disconnect(this.analyser);
    this.analyser.disconnect();
  }
}
