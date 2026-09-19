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
