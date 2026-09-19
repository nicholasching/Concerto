export const CODEBOOK_VERSION = "hamming16-11-v1" as const;
export const SYMBOL_MS = 200;
export const PACKET_SYMBOLS = 55;
export type OpticalSymbol = 0 | 1 | null;

// Project-defined protocol; not copied from BeatSync.
export function encodeDeviceId(deviceId: number): string {
  if (!Number.isInteger(deviceId) || deviceId < 0 || deviceId > 2047) throw new RangeError("deviceId must be 0..2047");
  const bits = Array<number>(17).fill(0);
  [3, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].forEach((position, i) => { bits[position] = (deviceId >> (10 - i)) & 1; });
  for (const parity of [1, 2, 4, 8]) {
    for (let position = 1; position <= 15; position++) if (position & parity) bits[parity] ^= bits[position];
  }
  bits[16] = bits.slice(1, 16).reduce((sum, bit) => sum ^ bit, 0);
  return bits.slice(1).join("");
}

export function calibrationPacket(deviceId: number, runTag: number): OpticalSymbol[] {
  if (!Number.isInteger(runTag) || runTag < 0 || runTag > 255) throw new RangeError("runTag must be 0..255");
  const word = [...encodeDeviceId(deviceId)].map(Number) as (0 | 1)[];
  const tag = [...runTag.toString(2).padStart(8, "0")].map(Number) as (0 | 1)[];
  return [null, null, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, ...tag, ...word, ...word.map(bit => (1 - bit) as 0 | 1), null, null];
}
