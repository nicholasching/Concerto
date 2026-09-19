import { PROTOCOL_VERSION, ClientMessage, type ServerMessageData } from "@orchestra/contracts";
import { epochNow } from "@orchestra/sync";

export interface ServerClock {
  sessionId: string;
  serverEpoch: string;
  nowServerMs(): number;
}

// A restart mints a new epoch, so schedules issued by the previous process can never
// be mistaken for current ones.
export const createServerClock = (sessionId = process.env.SESSION_ID ?? "dev-session"): ServerClock => ({
  sessionId,
  serverEpoch: crypto.randomUUID(),
  nowServerMs: epochNow,
});

const error = (clock: ServerClock, code: string, message: string): ServerMessageData => ({
  protocolVersion: PROTOCOL_VERSION,
  sessionId: clock.sessionId,
  serverEpoch: clock.serverEpoch,
  messageId: crypto.randomUUID(),
  type: "error",
  payload: { protocolVersion: PROTOCOL_VERSION, error: { code, message, retryable: false, owner: "sync-control" } },
});

/**
 * `receivedServerMs` is sampled by the socket before parsing, and t2 immediately before
 * returning, so the reply reports the real server-side residence time.
 */
export const handleClientMessage = (input: {
  raw: string;
  receivedServerMs: number;
  clock: ServerClock;
}): ServerMessageData => {
  const { raw, receivedServerMs, clock } = input;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return error(clock, "INVALID_JSON", "Message was not valid JSON.");
  }

  const message = ClientMessage.safeParse(parsed);
  if (!message.success) return error(clock, "INVALID_MESSAGE", "Message did not match the protocol v1 client schema.");
  if (message.data.sessionId !== clock.sessionId) {
    return error(clock, "WRONG_SESSION", "Message belongs to a different concert session.");
  }
  if (message.data.type !== "clock.probe") {
    return error(clock, "NOT_IMPLEMENTED", "Team 1 implements this message in a later slice; only clock.probe is served.");
  }

  // A probe carrying a stale serverEpoch is answered, not rejected: the reply is how a
  // reconnecting client discovers the new epoch and discards measurements from the old one.
  const { probeGroupId, probeGroupIndex, t0 } = message.data.payload;
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: clock.sessionId,
    serverEpoch: clock.serverEpoch,
    messageId: crypto.randomUUID(),
    type: "clock.reply",
    payload: { probeGroupId, probeGroupIndex, t0, t1: receivedServerMs, t2: clock.nowServerMs() },
  };
};
