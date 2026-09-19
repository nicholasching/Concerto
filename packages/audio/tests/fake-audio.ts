// Minimal AudioContext double. It records calls; it cannot prove anything about real output timing.
export class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started: number[] = [];
  stopped = 0;
  connected = false;
  connect() { this.connected = true; }
  disconnect() { this.connected = false; }
  start(when: number) { this.started.push(when); }
  stop() { this.stopped += 1; }
}

export class FakeAudioContext {
  state: string = "suspended";
  currentTime = 0;
  outputLatency = 0;
  outputTimestamp: { contextTime?: number; performanceTime?: number } = {};
  resumeCalls = 0;
  sources: FakeSource[] = [];
  destination = {};
  onstatechange: (() => void) | null = null;
  decoded = { length: 16000 * 8, numberOfChannels: 1, sampleRate: 16000, duration: 8 };

  async resume() { this.resumeCalls += 1; this.setState("running"); }
  async close() { this.setState("closed"); }
  setState(state: string) { this.state = state; this.onstatechange?.(); }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
  getOutputTimestamp() { return this.outputTimestamp; }
  async decodeAudioData(_bytes: ArrayBuffer) { return this.decoded; }
}

export const asAudioContext = (fake: FakeAudioContext) => fake as unknown as AudioContext;
