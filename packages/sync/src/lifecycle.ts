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
    this.epoch = null;
    this.estimator.reset();
  }

  accept(reply: ClockReply): void {
    const key = `${reply.probeGroupId}:${reply.probeGroupIndex}`;
    if (reply.serverEpoch !== this.epoch || this.sent.get(key) !== reply.t0) return;
    this.sent.delete(key);
    if (reply.t2 < reply.t1 || this.now() - reply.t0 < reply.t2 - reply.t1) return;
    this.estimator.accept(reply);
  }

  nowServerMs(): number { return this.estimator.nowServerMs(); }
  toLocalPerformanceMs(serverMs: number): number { return this.estimator.toLocalPerformanceMs(serverMs); }
  quality(): ClockQuality { return this.estimator.quality(); }

  private later(callback: () => void, ms: number): void {
    const generation = this.generation;
    const handle = this.timers.setTimeout(() => {
      this.handles = this.handles.filter(item => item !== handle);
      if (generation === this.generation) callback();
    }, ms);
    this.handles.push(handle);
  }

  private pair(): void {
    if (!this.epoch) return;
    for (const [key, t0] of this.sent) if (this.now() - t0 > PROBE_CONSTANTS.RESPONSE_TIMEOUT_MS) this.sent.delete(key);
    const probeGroupId = this.estimator.beginProbeGroup();
    const acceptedBefore = this.estimator.stats().pairsPure;
    const send = (probeGroupIndex: 0 | 1) => {
      const t0 = this.now();
      this.sent.set(`${probeGroupId}:${probeGroupIndex}`, t0);
      this.options.send({ probeGroupId, probeGroupIndex, t0 });
    };
    send(0);
    this.later(() => {
      send(1);
      // Give the reply a short window before choosing the cadence. A dropped/impure pair
      // needs a rapid retry: another full steady interval would expire the clock sample.
      this.later(() => {
        const accepted = this.estimator.stats().pairsPure > acceptedBefore;
        if (!accepted || !this.estimator.quality().ready) this.pair();
        else this.later(() => this.pair(), (PROBE_CONSTANTS.STEADY_STATE_INTERVAL_MS - PROBE_CONSTANTS.INITIAL_INTERVAL_MS)
          * (1 + (this.options.random ?? Math.random)() * 0.1));
      }, PROBE_CONSTANTS.INITIAL_INTERVAL_MS);
    }, PROBE_CONSTANTS.PROBE_GAP_MS);
  }
}
