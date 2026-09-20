import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { schemas, DeviceId, Location, JoinRequest, CalibrationManifest, ServerMessage } from "../src";
import { calibrationPacket, calibrationDurationMs, encodeDeviceId } from "../src/otc";
import book from "../generated/otc-codebook.json";
import manifest from "../../../fixtures/otc/clean-30/manifest.json";
import messages from "../../../fixtures/server-messages.json";

describe("wire boundary", () => {
  for (const [file, name] of Object.entries({ "admin-snapshot.json": "AdminSnapshot", "participant-snapshot.json": "ParticipantSnapshot", "show.json": "Show", "client-message.json": "ClientMessage", "otc/clean-30/manifest.json": "CalibrationManifest", "otc/clean-30/result.json": "OtcResult" } as const)) {
    test(`${name} fixture validates`, () => expect(schemas[name].safeParse(JSON.parse(readFileSync(`${import.meta.dir}/../../../fixtures/${file}`, "utf8"))).success).toBe(true));
  }
  test("every example server event validates", () => { for (const message of messages) ServerMessage.parse(message); });
  test("IDs include zero and reject wrapping/fractions", () => {
    expect(DeviceId.parse(0)).toBe(0); expect(DeviceId.parse(2047)).toBe(2047);
    for (const id of [-1, 2048, 1.5]) expect(DeviceId.safeParse(id).success).toBe(false);
  });
  test("join cannot claim a public device ID", () => expect(JoinRequest.safeParse({ deviceId: 4 }).success).toBe(false));
  test("unknown locations cannot be invented coordinates", () => {
    const item = { deviceId: 0, column: null, sourceCameraIds: [], decodeScore: null, mappingResidualPx: null, status: "unseen", mappingMode: "none", x: null, y: null };
    expect(Location.safeParse(item).success).toBe(true);
    expect(Location.safeParse({ ...item, x: 0, y: 0 }).success).toBe(false);
  });
  test("packet changes require a new contract", () => expect(CalibrationManifest.safeParse({ ...manifest, symbolMs: 100 }).success).toBe(false));
});

test("v2 removes only the optical tag and pairs 47 slots with 250 ms", () => {
  const packet = calibrationPacket(1, 0, "otc-v2");
  expect(packet).toEqual(calibrationPacket(1, 255, "otc-v2"));
  expect(packet).toHaveLength(47);
  expect(packet.slice(13, 29).join("")).toBe("1101000100000011");
  expect(packet.slice(29, 45)).toEqual(packet.slice(13, 29).map(bit => bit === 0 ? 1 as const : 0 as const));
  expect(calibrationDurationMs({ packetVersion: "otc-v2" })).toBe(11750);
  expect(calibrationDurationMs({ packetVersion: "otc-v1" })).toBe(11000);
  expect(CalibrationManifest.safeParse({ ...manifest, packetVersion: "otc-v2", symbolMs: 250 }).success).toBe(true);
  expect(CalibrationManifest.safeParse({ ...manifest, packetVersion: "otc-v2", symbolMs: 200 }).success).toBe(false);
  expect(CalibrationManifest.safeParse({ ...manifest, packetVersion: "otc-v1", symbolMs: 250 }).success).toBe(false);
});

describe("frozen optical codebook", () => {
  test("golden bit order and parity", () => {
    expect(encodeDeviceId(1)).toBe("1101000100000011");
    expect(encodeDeviceId(1024)).toBe("1110000000000001");
    for (let id = 0; id < 2048; id++) {
      const bits = book.codewords[id];
      expect(encodeDeviceId(id)).toBe(bits);
      const recovered = [3, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].map(position => bits[position - 1]).join("");
      expect(parseInt(recovered, 2)).toBe(id);
      expect([...bits].reduce((sum, bit) => sum + Number(bit), 0) % 2).toBe(0);
    }
  });
  test("all 2048 words have minimum pairwise distance four", () => {
    const words = book.codewords.map(bits => parseInt(bits, 2));
    let minimum = 16;
    for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) {
      let difference = words[i] ^ words[j], distance = 0;
      while (difference) { difference &= difference - 1; distance++; }
      minimum = Math.min(minimum, distance);
    }
    expect(new Set(words).size).toBe(2048); expect(minimum).toBe(4);
  });
  test("packet has guard, pilots, preamble, run tag, repeated complement, and exact duration", () => {
    const packet = calibrationPacket(1, 37, "otc-v1");
    expect(packet.length * 200).toBe(11000);
    expect(packet.slice(0, 6)).toEqual([null, null, 0, 0, 1, 1]);
    expect(packet.slice(6, 13).join("")).toBe("1110010");
    expect(packet.slice(13, 21).join("")).toBe("00100101");
    expect(packet.slice(21, 37).join("")).toBe("1101000100000011");
    expect(packet.slice(37, 53).map(bit => 1 - Number(bit)).join("")).toBe(packet.slice(21, 37).join(""));
    expect(packet.slice(53)).toEqual([null, null]);
    expect(() => calibrationPacket(0, 256, "otc-v1")).toThrow();
  });
});
