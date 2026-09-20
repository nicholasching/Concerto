import { expect, test } from "bun:test";
import { calibrationPacket as canonicalPacket, PACKET_SYMBOLS, SYMBOL_MS } from "../packages/contracts/src/otc";
import { DIAGNOSTIC_PALETTE, calibrationPacket, colorAt, encodeDeviceId } from "./public/packet.js";

test("standalone debug phone packet exactly matches the canonical OTC contract", () => {
  for (const deviceId of [0, 1, 7, 1024, 2047]) {
    for (const runTag of [0, 37, 255]) {
      const packet = calibrationPacket(deviceId, runTag);
      expect(packet).toEqual(canonicalPacket(deviceId, runTag));
      expect(packet).toHaveLength(PACKET_SYMBOLS);
    }
  }
});

test("debug phone uses red and blue during the packet then holds the chosen colour", () => {
  const packet = calibrationPacket(7, 37);
  expect(DIAGNOSTIC_PALETTE).toEqual({ zero: "#FF0000", one: "#0066FF", neutral: "#111111" });
  expect(colorAt(0, "#0066FF", packet)).toBe("#111111");
  expect(colorAt(2 * SYMBOL_MS, "#0066FF", packet)).toBe("#FF0000");
  expect(colorAt(PACKET_SYMBOLS * SYMBOL_MS, "#0066FF", packet)).toBe("#0066FF");
});

test("debug phone bounds the same device ID range as the production contract", () => {
  expect(() => encodeDeviceId(-1)).toThrow(RangeError);
  expect(() => calibrationPacket(2048, 1)).toThrow(RangeError);
  expect(() => calibrationPacket(1, 256)).toThrow(RangeError);
});
