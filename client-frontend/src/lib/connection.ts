import { ServerMessage, type ClientMessageData, type ParticipantSnapshotData } from "@orchestra/contracts";
import type { JoinData, JoinResult } from "./join";

// Backoff adapted from BeatSync apps/client/src/hooks/useWebSocketReconnection.ts (MIT).
export const BACKOFF = { initialMs: 1000, factor: 1.1, maxMs: 10000, jitter: 0.15, maxAttempts: 15, connectTimeoutMs: 5000 };
export const REPLACED_CLOSE_CODE = 4001;
const OPEN = 1;

export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF.initialMs * BACKOFF.factor ** (attempt - 1), BACKOFF.maxMs);
  return base + random() * BACKOFF.jitter * base;
}

// Proposal for Team 1: the socket proves its identity with the resume token.
export function socketUrl(wsUrl: string, resumeToken: string): string {
  const url = new URL(wsUrl);
  url.searchParams.set("token", resumeToken);
  return url.toString();
}

/** Same epoch: never go back in revision. New epoch (server restart): always take the new state. */
export function acceptSnapshot(current: ParticipantSnapshotData | null, incoming: ParticipantSnapshotData): boolean {
  if (!current || current.serverEpoch !== incoming.serverEpoch) return true;
  return incoming.revision >= current.revision;
}

export type ConnectionStatus =
  | { kind: "joining"; attempt: number }
  | { kind: "connected" }
  | { kind: "reconnecting"; attempt: number }
  | { kind: "gave-up" }
  | { kind: "replaced" }
  | { kind: "full" };

export interface ConnectionState {
  status: ConnectionStatus;
  identity: JoinData | null;
  snapshot: ParticipantSnapshotData | null;
  notice: string | null;
}

export interface SocketLike {
  readyState: number;
  onclose: ((event: { code: number }) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Adapts a browser WebSocket to SocketLike. */
export function browserSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  const socket: SocketLike = {
    get readyState() { return ws.readyState; },
    onclose: null,
    onmessage: null,
    send: data => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
  };
  ws.onclose = event => socket.onclose?.(event);
  ws.onmessage = event => socket.onmessage?.(event);
  return socket;
}

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ConnectionOptions {
  wsUrl: string;
  join: () => Promise<JoinResult>;
  openSocket: (url: string) => SocketLike;
  onChange: (state: ConnectionState) => void;
  timers?: Timers;
  random?: () => number;
  log?: (message: string) => void;
}

const defaultTimers: Timers = { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

// Each (re)connect resumes identity over HTTP first, then opens a token-bound socket.
// The first state.snapshot for our own device marks the connection usable.
export class ParticipantConnection {
  private state: ConnectionState = { status: { kind: "joining", attempt: 0 }, identity: null, snapshot: null, notice: null };
  private socket: SocketLike | null = null;
  private attempts = 0;
  private inFlight = false;
  private stopped = false;
  private retryTimer: unknown = null;
  private connectTimer: unknown = null;
  private readonly timers: Timers;
  private readonly random: () => number;
  private readonly log: (message: string) => void;

  constructor(private readonly options: ConnectionOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.random = options.random ?? Math.random;
    this.log = options.log ?? (message => console.warn(`[connection] ${message}`));
  }

  get current(): ConnectionState { return this.state; }

  start(): void { void this.connect(); }

  /** Visibility/online events: reconnect now unless connected, replaced or full. */
  wake(): void {
    const kind = this.state.status.kind;
    if (this.stopped || kind === "connected" || kind === "replaced" || kind === "full") return;
    this.retryNow();
  }

  /** Explicit user tap: also reclaims the identity from another tab. */
  retry(): void {
    if (this.stopped || this.state.status.kind === "full") return;
    this.retryNow();
  }

  send(message: ClientMessageData): boolean {
    if (this.socket?.readyState !== OPEN || this.state.status.kind !== "connected") return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.dropSocket();
  }

  private retryNow(): void {
    if (this.inFlight) return;
    this.attempts = 0;
    this.clearTimers();
    this.dropSocket();
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.inFlight) return;
    this.inFlight = true;
    if (!this.state.identity) this.update({ status: { kind: "joining", attempt: this.attempts } });
    const result = await this.options.join();
    this.inFlight = false;
    if (this.stopped) return;
    if (result.status === "full") { this.update({ status: { kind: "full" } }); return; }
    if (result.status === "error") { this.log(`join failed: ${result.message}`); this.scheduleRetry(); return; }
    const notice = result.tokenRejected ? "Your previous session was not recognized, so you joined as a new device." : this.state.notice;
    this.update({ identity: result.join, notice });
    this.openSocket(result.join.resumeToken);
  }

  private openSocket(resumeToken: string): void {
    const socket = this.options.openSocket(socketUrl(this.options.wsUrl, resumeToken));
    this.socket = socket;
    // Safari can drop a socket without firing close; give up on it after a timeout.
    this.connectTimer = this.timers.setTimeout(() => {
      if (this.socket === socket && this.state.status.kind !== "connected") { this.dropSocket(); this.scheduleRetry(); }
    }, BACKOFF.connectTimeoutMs);
    socket.onmessage = event => { if (this.socket === socket) this.receive(event.data); };
    socket.onclose = event => {
      if (this.socket !== socket || this.stopped) return;
      this.socket = null;
      if (event.code === REPLACED_CLOSE_CODE) { this.clearTimers(); this.update({ status: { kind: "replaced" } }); return; }
      this.scheduleRetry();
    };
  }

  private receive(data: unknown): void {
    let body: unknown;
    try { body = JSON.parse(String(data)); } catch { this.log("dropped non-JSON message"); return; }
    const parsed = ServerMessage.safeParse(body);
    if (!parsed.success) { this.log("dropped message that failed ServerMessage validation"); return; }
    const message = parsed.data;
    if (message.type !== "state.snapshot") return;
    const snapshot = message.payload;
    const identity = this.state.identity;
    if (snapshot.role !== "participant" || !identity || snapshot.deviceId !== identity.deviceId || snapshot.sessionId !== identity.sessionId) {
      this.log("dropped snapshot for another device or session");
      return;
    }
    if (!acceptSnapshot(this.state.snapshot, snapshot)) { this.log(`ignored stale snapshot revision ${snapshot.revision}`); return; }
    if (this.state.status.kind !== "connected") {
      this.attempts = 0;
      if (this.connectTimer !== null) { this.timers.clearTimeout(this.connectTimer); this.connectTimer = null; }
    }
    this.update({ status: { kind: "connected" }, snapshot });
  }

  private scheduleRetry(): void {
    this.attempts += 1;
    if (this.attempts >= BACKOFF.maxAttempts) { this.update({ status: { kind: "gave-up" } }); return; }
    this.update({ status: this.state.identity ? { kind: "reconnecting", attempt: this.attempts } : { kind: "joining", attempt: this.attempts } });
    this.retryTimer = this.timers.setTimeout(() => { this.retryTimer = null; void this.connect(); }, backoffDelayMs(this.attempts, this.random));
  }

  private dropSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onclose = null;
    socket.onmessage = null;
    socket.close();
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    if (this.connectTimer !== null) this.timers.clearTimeout(this.connectTimer);
    this.retryTimer = null;
    this.connectTimer = null;
  }

  private update(patch: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...patch };
    this.options.onChange(this.state);
  }
}
