export const SYMBOL_MS = 200;
export const PACKET_SYMBOLS = 55;
export const DIAGNOSTIC_PALETTE = Object.freeze({ zero: "#FF0000", one: "#0066FF", neutral: "#111111" });

function boundedInteger(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be ${minimum}..${maximum}`);
  }
}

export function encodeDeviceId(deviceId) {
  boundedInteger(deviceId, 0, 2047, "deviceId");
  const bits = Array(17).fill(0);
  [3, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].forEach((position, index) => {
    bits[position] = (deviceId >> (10 - index)) & 1;
  });
  for (const parity of [1, 2, 4, 8]) {
    for (let position = 1; position <= 15; position += 1) {
      if (position & parity) bits[parity] ^= bits[position];
    }
  }
  bits[16] = bits.slice(1, 16).reduce((sum, bit) => sum ^ bit, 0);
  return bits.slice(1).join("");
}

/** The canonical 55-slot OTC packet, kept standalone so this bench has no concert runtime dependency. */
export function calibrationPacket(deviceId, runTag) {
  boundedInteger(runTag, 0, 255, "runTag");
  const word = [...encodeDeviceId(deviceId)].map(Number);
  const tag = [...runTag.toString(2).padStart(8, "0")].map(Number);
  return [null, null, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, ...tag, ...word, ...word.map(bit => 1 - bit), null, null];
}

export function colorAt(elapsedMs, holdColor, packet) {
  const symbol = packet[Math.floor(elapsedMs / SYMBOL_MS)];
  if (symbol === undefined) return holdColor;
  return symbol === null ? DIAGNOSTIC_PALETTE.neutral : symbol === 0 ? DIAGNOSTIC_PALETTE.zero : DIAGNOSTIC_PALETTE.one;
}
