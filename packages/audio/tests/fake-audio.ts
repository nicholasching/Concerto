// Minimal AudioContext double. It records calls; it cannot prove anything about real output timing.
export class FakeParam {
  value = 1;
  events: [string, ...number[]][] = [];
  setValueAtTime(value: number, time: number) { this.events.push(["set", value, time]); }
  linearRampToValueAtTime(value: number, time: number) { this.events.push(["ramp", value, time]); }
  cancelScheduledValues(time: number) { this.events.push(["cancel", time]); }
  /** Value at an audio time from the recorded automation (set/ramp/cancel only). */
  at(time: number): number {
    let points: { t: number; v: number; ramp: boolean }[] = [];
    for (const [kind, a, b] of this.events) {
      if (kind === "cancel") points = points.filter(point => point.t < a);
      else points.push({ t: b, v: a, ramp: kind === "ramp" });
    }
    let value = this.value;
    let previous: { t: number; v: number } | null = null;
    for (const point of points.sort((x, y) => x.t - y.t)) {
      if (point.t <= time) { value = point.v; previous = point; continue; }
      if (point.ramp && previous) value = previous.v + (point.v - previous.v) * (time - previous.t) / (point.t - previous.t);
      break;
    }
    return value;
  }
}

export class FakeGain {
  gain = new FakeParam();
  outputs: unknown[] = [];
  connect(node: unknown) { this.outputs.push(node); }
  disconnect() { this.outputs = []; }
}

export class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started: number[] = [];
  startArgs: number[][] = [];
  stopped = 0;
  connected = false;
  outputs: unknown[] = [];
  connect(node: unknown) { this.connected = true; this.outputs.push(node); }
  disconnect() { this.connected = false; }
  start(when: number, offset?: number, duration?: number) {
    this.started.push(when);
    this.startArgs.push([when, offset ?? 0, duration ?? Infinity]);
  }
  stop() { this.stopped += 1; }
}

export class FakeAudioContext {
  state: string = "suspended";
  currentTime = 0;
  outputLatency = 0;
  outputTimestamp: { contextTime?: number; performanceTime?: number } = {};
  resumeCalls = 0;
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  destination = {};
  onstatechange: (() => void) | null = null;
  decoded = { length: 16000 * 8, numberOfChannels: 1, sampleRate: 16000, duration: 8 };

  async resume() { this.resumeCalls += 1; this.setState("running"); }
  async close() { this.setState("closed"); }
  setState(state: string) { this.state = state; this.onstatechange?.(); }
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
  getOutputTimestamp() { return this.outputTimestamp; }
  async decodeAudioData(_bytes: ArrayBuffer) { return this.decoded; }
}

export const asAudioContext = (fake: FakeAudioContext) => fake as unknown as AudioContext;
