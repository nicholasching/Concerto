import { expect, test } from "bun:test";
import { calibrationPacket, SYMBOL_MS } from "@orchestra/contracts/otc";
import { symbolColor } from "../src/lib/calibration";
import { DETECTOR_PALETTE, detectorColorAt, detectorStageAt } from "../src/lib/detector-test";

test("detector test emits the exact production OTC packet before holding its chosen color", () => {
  const deviceId = 7;
  const runTag = 37;
  const packet = calibrationPacket(deviceId, runTag);
  expect(detectorStageAt(-1, deviceId, runTag)).toBe("idle");
  for (const [slot, symbol] of packet.entries()) {
    expect(detectorColorAt(slot * SYMBOL_MS + SYMBOL_MS / 2, "#0066ff", deviceId, runTag))
      .toBe(symbolColor(symbol, DETECTOR_PALETTE));
  }
  expect(detectorStageAt(packet.length * SYMBOL_MS, deviceId, runTag)).toBe("hold");
  expect(detectorColorAt(packet.length * SYMBOL_MS, "#0066ff", deviceId, runTag)).toBe("#0066ff");
});
