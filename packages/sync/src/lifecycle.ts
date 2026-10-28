import { epochNow, type ClockQuality, type SynchronizedClock } from "./epoch";
import { CLOCK_PROFILES, ClockEstimator, PROBE_CONSTANTS, type ClockProfile, type ClockReply } from "./estimator";

export interface Probe { probeGroupId: number; probeGroupIndex: 0 | 1; t0: number }
export interface ProbeTimers { setTimeout(callback: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }

/** One probe lifecycle for browser and control consumers; no UI or audio clock adjustments. */
export class ClockSync implements SynchronizedClock {
  readonly estimator: ClockEstimator;
  private epoch: string | null = null;
  private readonly timers: ProbeTimers;
  private readonly now: () => number;
  private readonly sent = new Map<string, number>();
  private handles: unknown[] = [];
  private generation = 0;
  private groups = new Map<number, { timeout: unknown }>();
  private nextPair: unknown = null;
  private nextPairAt = Infinity;
  private lastRttMs: number | null = null;
  private failures = 0;

  constructor(private readonly options: {
    send: (probe: Probe) => void; timers?: ProbeTimers; now?: () => number;
    random?: () => number; estimator?: ClockEstimator; profile?: ClockProfile;
  }) {
    this.now = options.now ?? epochNow;
    this.estimator = options.estimator ?? new ClockEstimator({ ...CLOCK_PROFILES[options.profile ?? "strict"], now: this.now });
    this.timers = options.timers ?? { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  }

  start(serverEpoch: string): void {
    if (serverEpoch === this.epoch) return;
    this.stop();
    this.epoch = serverEpoch;
    this.later(() => this.pair(), (this.options.random ?? Math.random)() * 200);
  }

  refresh(): void { const epoch = this.epoch; if (epoch) { this.stop(); this.start(epoch); } }
  stop(): void {
    this.generation++;
    for (const handle of this.handles) this.timers.clearTimeout(handle);
    this.handles = [];
    this.sent.clear();
    this.groups.clear();
    this.nextPair = null;
    this.nextPairAt = Infinity;
    this.lastRttMs = null;
    this.failures = 0;
    this.epoch = null;
    this.estimator.reset();
  }

  accept(reply: ClockReply): void {
    const key = `${reply.probeGroupId}:${reply.probeGroupIndex}`;
    if (reply.serverEpoch !== this.epoch || this.sent.get(key) !== reply.t0) return;
    this.sent.delete(key);
    if (reply.t2 < reply.t1 || this.now() - reply.t0 < reply.t2 - reply.t1) return;
    const accepted = this.estimator.accept(reply);
    const elapsed = this.now() - reply.t0;
    this.lastRttMs = this.lastRttMs === null ? elapsed : this.lastRttMs * 0.8 + elapsed * 0.2;
    if (reply.probeGroupIndex === 1) this.finishPair(reply.probeGroupId, accepted !== null);
  }

  nowServerMs(): number { return this.estimator.nowServerMs(); }
  toLocalPerformanceMs(serverMs: number): number { return this.estimator.toLocalPerformanceMs(serverMs); }
  quality(): ClockQuality { return this.estimator.quality(); }

  private later(callback: () => void, ms: number): unknown {
    const generation = this.generation;
    const handle = this.timers.setTimeout(() => {
      this.handles = this.handles.filter(item => item !== handle);
      if (generation === this.generation) callback();
    }, ms);
    this.handles.push(handle);
    return handle;
  }

  private pair(): void {
    if (!this.epoch) return;
    // A bounded pipeline keeps independent pairs available during WAN jitter.
    if (this.groups.size >= 4) { this.schedulePair(250); return; }
    const probeGroupId = this.estimator.beginProbeGroup();
    this.groups.set(probeGroupId, { timeout: null });
    const send = (probeGroupIndex: 0 | 1) => {
      const t0 = this.now();
      this.sent.set(`${probeGroupId}:${probeGroupIndex}`, t0);
      this.options.send({ probeGroupId, probeGroupIndex, t0 });
    };
    send(0);
    this.later(() => {
      if (!this.groups.has(probeGroupId)) return;
      send(1);
      const group = this.groups.get(probeGroupId);
      if (group) {
        const responseMs = Math.min(PROBE_CONSTANTS.RESPONSE_TIMEOUT_MS, Math.max(250, (this.lastRttMs ?? 450) * 2 + 100));
        group.timeout = this.later(() => this.finishPair(probeGroupId, false), responseMs);
      }
    }, PROBE_CONSTANTS.PROBE_GAP_MS);
    this.schedulePair(this.estimator.stats().measurements >= PROBE_CONSTANTS.MAX_MEASUREMENTS && this.failures === 0
      ? PROBE_CONSTANTS.STEADY_STATE_INTERVAL_MS : 250);
  }

  private schedulePair(delay: number): void {
    const jittered = delay * (1 + (this.options.random ?? Math.random)() * 0.1);
    const at = this.now() + jittered;
    if (this.nextPairAt <= at) return;
    if (this.nextPair !== null) {
      this.timers.clearTimeout(this.nextPair);
      this.handles = this.handles.filter(handle => handle !== this.nextPair);
    }
    this.nextPairAt = at;
    this.nextPair = this.later(() => {
      this.nextPair = null; this.nextPairAt = Infinity; this.pair();
    }, jittered);
  }

  private finishPair(id: number, accepted: boolean): void {
    const group = this.groups.get(id);
    if (!group) return;
    this.groups.delete(id);
    if (group.timeout !== null) {
      this.timers.clearTimeout(group.timeout);
      this.handles = this.handles.filter(handle => handle !== group.timeout);
    }
    this.sent.delete(`${id}:0`);
    this.sent.delete(`${id}:1`);
    this.estimator.discardProbeGroup(id);
    this.failures = accepted ? 0 : this.failures + 1;
    if (accepted && this.estimator.stats().measurements < PROBE_CONSTANTS.MAX_MEASUREMENTS) {
      this.schedulePair(Math.max(75, Math.min(250, (this.lastRttMs ?? 500) / 2)));
    }
    if (!accepted) this.schedulePair(Math.min(500, 250 * this.failures));
  }
}
