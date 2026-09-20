import { ClockSync } from "@orchestra/sync";
import { ServerMessage } from "@orchestra/contracts";

let socket: WebSocket | null = null;
let identity: { sessionId: string; serverEpoch: string } | null = null;
let closeCurrent: (() => void) | null = null;
const clock = new ClockSync({ send: payload => {
  if (socket?.readyState === WebSocket.OPEN && identity) socket.send(JSON.stringify({ protocolVersion: 1, ...identity,
    messageId: crypto.randomUUID(), type: "clock.probe", payload }));
} });

export function connectClock(url: string): () => void {
  closeCurrent?.();
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const open = () => {
    if (stopped) return;
    const ws = new WebSocket(url); socket = ws;
    ws.onmessage = event => {
      if (ws !== socket) return;
      let raw: unknown;
      try { raw = JSON.parse(String(event.data)); } catch { return; }
      const parsed = ServerMessage.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === "state.snapshot" && message.payload.role === "admin") {
        identity = { sessionId: message.sessionId, serverEpoch: message.serverEpoch };
        clock.start(message.serverEpoch);
      } else if (message.type === "clock.reply" && message.serverEpoch === identity?.serverEpoch) clock.accept({ ...message.payload, serverEpoch: message.serverEpoch });
    };
    ws.onclose = () => { if (ws !== socket) return; clock.stop(); if (!stopped) retry = setTimeout(open, 1000); };
  };
  const visibility = () => { if (document.visibilityState === "visible") clock.refresh(); };
  document.addEventListener("visibilitychange", visibility);
  open();
  closeCurrent = () => { stopped = true; if (retry) clearTimeout(retry); socket?.close(); socket = null; clock.stop(); document.removeEventListener("visibilitychange", visibility); };
  return closeCurrent;
}

export const nowServerMs = () => clock.nowServerMs();
export const clockReady = () => clock.quality().ready;
export const lastSyncAgeMs = () => clock.quality().sampleAgeMs ?? Infinity;
export function futureServerMs(seconds = 2): number {
  if (!clockReady()) throw new Error("Wait for the operator clock to synchronize.");
  return nowServerMs() + Math.max(2, seconds) * 1000;
}
export function showPositionMs(transport: { status: string; positionMs: number; startServerMs: number | null }): number {
  return transport.status === "playing" && transport.startServerMs !== null && clockReady()
    ? transport.positionMs + Math.max(0, nowServerMs() - transport.startServerMs) : transport.positionMs;
}
