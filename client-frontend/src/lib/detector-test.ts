import { calibrationPacket, SYMBOL_MS } from "@orchestra/contracts/otc";
import { symbolColor, type Palette } from "./calibration";

export const DETECTOR_PALETTE: Palette = { zero: "#FF0000", one: "#0066FF", neutral: "#111111" };

export type DetectorStage = "idle" | "packet" | "hold";

export function detectorStageAt(elapsedMs: number, deviceId: number, runTag: number): DetectorStage {
  if (elapsedMs < 0) return "idle";
  return elapsedMs < calibrationPacket(deviceId, runTag).length * SYMBOL_MS ? "packet" : "hold";
}

/** Uses the frozen OTC packet slots with the red/blue diagnostic palette. */
export function detectorColorAt(elapsedMs: number, holdColor: string, deviceId: number, runTag: number): string {
  const packet = calibrationPacket(deviceId, runTag);
  const slot = Math.floor(elapsedMs / SYMBOL_MS);
  return slot >= 0 && slot < packet.length ? symbolColor(packet[slot], DETECTOR_PALETTE) : holdColor;
}
