import { ClientMessage, type ClientMessageData, type ServerMessageData } from "@orchestra/contracts";
import { calibrationPacket, type OpticalSymbol } from "@orchestra/contracts/otc";

export type PrepareMessage = Extract<ServerMessageData, { type: "calibration.prepare" }>;
export type ArmMessage = Extract<ServerMessageData, { type: "calibration.arm" }>;
export type CalibrationPlanData = PrepareMessage["payload"]["plan"];
export type CalibrationRunData = ArmMessage["payload"]["run"];
export type Palette = CalibrationPlanData["palette"];
export type AbortReason = "late" | "hidden" | "clock" | "disconnected" | "superseded" | "opted-out";

/** Slot index at a server time. Negative before the start. Derived from absolute time so a skipped frame never shifts later slots. */
export function slotAt(nowServerMs: number, startServerMs: number, symbolMs: number): number {
  return Math.floor((nowServerMs - startServerMs) / symbolMs);
}

export function symbolColor(symbol: OpticalSymbol, palette: Palette): string {
  return symbol === null ? palette.neutral : symbol === 0 ? palette.zero : palette.one;
}

export interface Eligibility { foreground: boolean; clockUsable: boolean; optedOut: boolean }
export interface CalibrationIdentity { sessionId: string; serverEpoch: string; deviceId: number }

export type CalibrationPhase =
  | { kind: "idle" }
  | { kind: "prepared"; preparationId: string; plan: CalibrationPlanData }
  | { kind: "armed"; preparationId: string; run: CalibrationRunData; packet: OpticalSymbol[] }
  | { kind: "finished"; runId: string; completed: boolean; reason: string | null };

const planKeys = ["protocolVersion", "sessionId", "serverEpoch", "runId", "runTag", "packetVersion", "codebookVersion", "paletteVersion", "symbolMs"] as const;

function samePlan(plan: CalibrationPlanData, run: CalibrationRunData): boolean {
  return planKeys.every(key => plan[key] === run[key])
    && JSON.stringify(plan.palette) === JSON.stringify(run.palette)
    && JSON.stringify(plan.participantIds) === JSON.stringify(run.participantIds);
}

// Turns calibration messages and local events into ready/result messages.
// It never starts a run late and reports every run it accepted exactly once.
export class CalibrationSession {
  private state: CalibrationPhase = { kind: "idle" };

  constructor(
    private readonly send: (message: ClientMessageData) => void,
    private readonly identity: () => CalibrationIdentity | null,
    private readonly onChange: (phase: CalibrationPhase) => void = () => {},
  ) {}

  get phase(): CalibrationPhase { return this.state; }

  onPrepare(message: PrepareMessage, eligibility: Eligibility): void {
    const me = this.identity();
    const { plan, preparationId } = message.payload;
    if (!me || !this.matches(me, message) || plan.sessionId !== me.sessionId || plan.serverEpoch !== me.serverEpoch) return;
    if (this.state.kind === "armed") this.abort("superseded");
    if (!plan.participantIds.includes(me.deviceId)) { this.set({ kind: "idle" }); return; }
    const reason = eligibility.optedOut ? "opted-out" : !eligibility.foreground ? "hidden" : !eligibility.clockUsable ? "clock" : null;
    this.message(me, { type: "calibration.ready", payload: { preparationId, ready: reason === null, reason, runId: plan.runId } });
    this.set(reason === null ? { kind: "prepared", preparationId, plan } : { kind: "idle" });
  }

  /** Accepts only the arm for the exact plan this phone said yes to. Refuses a start that has already passed. */
  onArm(message: ArmMessage, nowServerMs: number): void {
    const me = this.identity();
    const { run, preparationId } = message.payload;
    if (!me || !this.matches(me, message) || this.state.kind !== "prepared") return;
    if (preparationId !== this.state.preparationId || !samePlan(this.state.plan, run) || message.effectiveServerMs !== run.startServerMs) return;
    if (nowServerMs >= run.startServerMs) { this.finish(me, run.runId, false, "late", 0); return; }
    this.set({ kind: "armed", preparationId, run, packet: calibrationPacket(me.deviceId, run.runTag, run.packetVersion) });
  }

  abort(reason: AbortReason): void {
    const me = this.identity();
    if (this.state.kind === "armed" && me) this.finish(me, this.state.run.runId, false, reason, 0);
    else if (this.state.kind === "prepared" && me) {
      // Withdraw the earlier yes so the server doesn't count this phone for the run.
      const { preparationId, plan } = this.state;
      this.message(me, { type: "calibration.ready", payload: { preparationId, ready: false, reason, runId: plan.runId } });
      this.set({ kind: "idle" });
    }
  }

  complete(maxFrameLatenessMs: number): void {
    const me = this.identity();
    if (this.state.kind === "armed" && me) this.finish(me, this.state.run.runId, true, null, maxFrameLatenessMs);
  }

  private matches(me: CalibrationIdentity, message: { sessionId: string; serverEpoch: string }): boolean {
    return message.sessionId === me.sessionId && message.serverEpoch === me.serverEpoch;
  }

  private finish(me: CalibrationIdentity, runId: string, completed: boolean, reason: string | null, maxFrameLatenessMs: number): void {
    this.message(me, { type: "calibration.result", payload: { runId, completed, maxFrameLatenessMs, reason } });
    this.set({ kind: "finished", runId, completed, reason });
  }

  private message(me: CalibrationIdentity, body: Pick<Extract<ClientMessageData, { type: "calibration.ready" | "calibration.result" }>, "type" | "payload">): void {
    this.send(ClientMessage.parse({ protocolVersion: 1, sessionId: me.sessionId, serverEpoch: me.serverEpoch, messageId: crypto.randomUUID(), ...body }));
  }

  private set(phase: CalibrationPhase): void {
    this.state = phase;
    this.onChange(phase);
  }
}
