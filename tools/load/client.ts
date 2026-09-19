import { ClientMessage, PROTOCOL_VERSION, ServerMessage } from "@orchestra/contracts";
// Relative import: tools/ is not a workspace, so @orchestra/sync does not resolve here. Adding it
// would change the root manifest and lockfile, which belong to the captain.
import { ClockEstimator, PROBE_CONSTANTS, epochNow } from "../../packages/sync/src/index";

export interface ClientResult {
  deviceId: number;
  joinMs: number;
  purePairs: number;
  impurePairs: number;
  clockReadyWhenAcknowledged: boolean;
  acknowledgedPreparation: boolean;
  acknowledgedBeforeDeadline: boolean;
  cueMarginMs: number | null;
  reconnected: boolean;
  joinRetries: number;
  connectRetries: number;
  leaseExpiries: number;
  cueLearnedFrom: "broadcast" | "snapshot" | null;
  errors: string[];
}

/**
 * One simulated phone. It does what a real client does to the control plane: join, hold a socket,
 * run coded probe pairs through the real estimator, report readiness, and acknowledge preparations.
 * It renders nothing and makes no sound, so it proves server behaviour and nothing about audio.
 */
export class SimulatedClient {
  readonly result: ClientResult;
  private socket: WebSocket | null = null;
  private estimator = new ClockEstimator();
  private resumeToken = "";
  private serverEpoch = "";
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private cueDeadlineServerMs: number | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly sessionId: string,
    private readonly ackDelayMs: number,
  ) {
    this.result = {
      deviceId: -1, joinMs: 0, purePairs: 0, impurePairs: 0, clockReadyWhenAcknowledged: false,
      acknowledgedPreparation: false, acknowledgedBeforeDeadline: false, cueMarginMs: null,
      reconnected: false, joinRetries: 0, connectRetries: 0, leaseExpiries: 0, cueLearnedFrom: null, errors: [],
    };
  }

  // The server sheds joins under load and marks the refusal retryable, so a client that gives up
  // on the first 429 is not modelling a phone: it is modelling a bug. Backoff is jittered so the
  // retries do not arrive as one wave again.
  async join(attempts = 8): Promise<void> {
    const started = performance.now();
    let response: Response | null = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      response = await fetch(`${this.baseUrl}/api/sessions/${this.sessionId}/join`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(this.resumeToken ? { resumeToken: this.resumeToken } : {}),
      });
      if (response.status !== 429) break;
      this.result.joinRetries++;
      await Bun.sleep(100 * 2 ** attempt * (0.5 + Math.random()));
    }
    if (!response || !response.ok) {
      this.result.errors.push(`join failed with ${response?.status ?? "no response"}`);
      return;
    }
    const body = await response.json();
    this.result.deviceId = body.deviceId;
    this.resumeToken = body.resumeToken;
    this.serverEpoch = body.serverEpoch;
    this.result.joinMs = performance.now() - started;
  }

  // A socket that fails to open under a connection storm is retried, the way a phone whose first
  // attempt lost a race would. Without this the harness reports a delivery failure for something a
  // real client would have recovered from in a second.
  async connect(attempts = 4): Promise<void> {
    if (!this.resumeToken) return;
    const url = `${this.baseUrl.replace("http", "ws")}/ws?resumeToken=${this.resumeToken}`;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const socket = new WebSocket(url);
      const opened = await new Promise<boolean>(resolve => {
        socket.onopen = () => resolve(true);
        socket.onerror = () => resolve(false);
        socket.onclose = () => resolve(false);
      });
      if (opened) {
        this.socket = socket;
        socket.onclose = null;
        socket.onmessage = event => this.receive(String(event.data));
        if (attempt > 0) this.result.connectRetries = attempt;
        return;
      }
      this.result.connectRetries = attempt + 1;
      await Bun.sleep(150 * 2 ** attempt * (0.5 + Math.random()));
    }
    this.result.errors.push(`socket never opened after ${attempts} attempts`);
  }

  start(): void {
    this.statusTimer = setInterval(() => this.reportStatus(), 2000);
    this.probePair();
    this.scheduleNextProbe();
  }

  stop(): void {
    if (this.probeTimer) clearTimeout(this.probeTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.probeTimer = null;
    this.statusTimer = null;
    this.socket?.close();
  }

  async reconnect(): Promise<void> {
    this.stop();
    this.estimator = new ClockEstimator();
    await this.join();
    await this.connect();
    this.start();
    this.result.reconnected = true;
    // A client that dropped during a cue missed its broadcast. Resnapshotting is how a real
    // client recovers, and the harness has to model that or it measures the wrong thing.
    await this.resnapshot();
  }

  async resnapshot(): Promise<void> {
    if (!this.resumeToken) return;
    const response = await fetch(`${this.baseUrl}/api/sessions/${this.sessionId}/snapshot`, {
      headers: { "x-resume-token": this.resumeToken },
    });
    if (!response.ok) {
      this.result.errors.push(`snapshot failed with ${response.status}`);
      return;
    }
    const snapshot = await response.json();
    const pending = (snapshot.pendingActions ?? []).find((action: { domain: string }) => action.domain === "transport");
    if (!pending || this.result.cueLearnedFrom !== null) return;
    this.result.cueLearnedFrom = "snapshot";
    this.result.cueMarginMs = pending.effectiveServerMs - snapshot.serverMs;
  }

  private send(type: "clock.probe" | "device.status" | "transport.ready" | "calibration.ready", payload: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(JSON.stringify(ClientMessage.parse({
        protocolVersion: PROTOCOL_VERSION, sessionId: this.sessionId, serverEpoch: this.serverEpoch || "unknown",
        messageId: crypto.randomUUID(), type, payload,
      })));
    } catch (cause) {
      this.result.errors.push(`send ${type}: ${(cause as Error).message}`);
    }
  }

  private probePair(): void {
    const probeGroupId = this.estimator.beginProbeGroup();
    this.send("clock.probe", { probeGroupId, probeGroupIndex: 0, t0: epochNow() });
    setTimeout(() => this.send("clock.probe", { probeGroupId, probeGroupIndex: 1, t0: epochNow() }), PROBE_CONSTANTS.PROBE_GAP_MS);
  }

  private scheduleNextProbe(): void {
    this.probeTimer = setTimeout(() => {
      this.probePair();
      // Re-read the policy after every pair: it is intentionally rapid while the measurement
      // window fills, then settles to the steady cadence once the clock is ready.
      this.scheduleNextProbe();
    }, this.estimator.nextProbeDelayMs());
  }

  private reportStatus(): void {
    const quality = this.estimator.quality();
    this.send("device.status", {
      deviceId: this.result.deviceId, connected: true, foreground: true,
      clockReady: quality.ready, clockUncertaintyMs: quality.uncertaintyMs, clockSampleAgeMs: quality.sampleAgeMs,
      audioUnlocked: true, decodedTrackHashes: {},
    });
  }

  private receive(raw: string): void {
    let message;
    try {
      message = ServerMessage.parse(JSON.parse(raw));
    } catch {
      this.result.errors.push("unparseable server message");
      return;
    }
    if (message.type === "clock.reply") {
      this.estimator.accept({ serverEpoch: message.serverEpoch, ...message.payload });
      const stats = this.estimator.stats();
      this.result.purePairs = stats.pairsPure;
      this.result.impurePairs = stats.pairsImpure;
      return;
    }
    if (message.type === "lease.renew") {
      if (message.payload.expiresServerMs <= this.estimator.nowServerMs()) this.result.leaseExpiries++;
      return;
    }
    if (message.type === "transport.prepare") {
      const payload = message.payload;
      // A real phone takes time to decode assets before it can honestly say it is ready.
      setTimeout(() => {
        this.result.clockReadyWhenAcknowledged = this.estimator.quality().ready;
        this.send("transport.ready", {
          preparationId: payload.preparationId, ready: true, reason: null,
          showRevision: payload.showRevision, transportRevision: payload.transportRevision,
        });
        this.result.acknowledgedPreparation = true;
        if (this.cueDeadlineServerMs === null || this.estimator.nowServerMs() < this.cueDeadlineServerMs) {
          this.result.acknowledgedBeforeDeadline = true;
        }
      }, this.ackDelayMs);
      return;
    }
    if (message.type === "calibration.prepare") {
      const payload = message.payload;
      setTimeout(() => this.send("calibration.ready", {
        preparationId: payload.preparationId, runId: payload.plan.runId, ready: true, reason: null,
      }), this.ackDelayMs);
      return;
    }
    if (message.type === "transport.commit") {
      // How much warning the phone got before the moment it has to act on.
      this.result.cueMarginMs = message.effectiveServerMs - this.estimator.nowServerMs();
      this.result.cueLearnedFrom ??= "broadcast";
      return;
    }
    if (message.type === "error") this.result.errors.push(`server error ${message.payload.error.code}`);
  }

  noteCueDeadline(effectiveServerMs: number): void {
    this.cueDeadlineServerMs = effectiveServerMs;
  }
}
