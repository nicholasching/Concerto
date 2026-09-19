import { Transport } from "@orchestra/contracts";
import { z } from "zod";

type TransportData = z.infer<typeof Transport>;
export type TransportAction = "prepare" | "play" | "pause" | "seek" | "stop";

// Where the playhead will be at a given server time, given the currently effective transport.
export const positionAt = (transport: TransportData, serverMs: number): number => {
  if (transport.status !== "playing") return transport.positionMs;
  return Math.max(0, transport.positionMs + (serverMs - transport.startServerMs));
};

/**
 * The transport state that becomes effective at `effectiveServerMs`. `startServerMs` is that
 * future moment, never the time the command was received: a phone schedules against it, so a
 * receipt timestamp here would make every device start at a different point in the music.
 */
export const nextTransport = (input: {
  current: TransportData;
  action: Exclude<TransportAction, "prepare">;
  positionMs: number;
  effectiveServerMs: number;
  showRevision: number;
}): TransportData => {
  const transportRevision = input.current.transportRevision + 1;
  const base = { transportRevision, showRevision: input.showRevision };

  switch (input.action) {
    case "play":
      return Transport.parse({ ...base, status: "playing", positionMs: input.positionMs, startServerMs: input.effectiveServerMs });
    case "pause":
      return Transport.parse({
        ...base, status: "paused", positionMs: positionAt(input.current, input.effectiveServerMs), startServerMs: null,
      });
    case "stop":
      return Transport.parse({ ...base, status: "stopped", positionMs: 0, startServerMs: null });
    case "seek":
      return input.current.status === "playing"
        ? Transport.parse({ ...base, status: "playing", positionMs: input.positionMs, startServerMs: input.effectiveServerMs })
        : Transport.parse({ ...base, status: "paused", positionMs: input.positionMs, startServerMs: null });
  }
};
