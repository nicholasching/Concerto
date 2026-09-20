import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { schemas } from "../packages/contracts/src";
import { calibrationPacket, encodeDeviceId } from "../packages/contracts/src/otc";

const check = process.argv.includes("--check");
function output(path: string, value: unknown) {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (check) {
    if (readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== text) throw new Error(`Generated file is stale: ${path}`);
  } else writeFileSync(path, text);
}
const directory = resolve("packages/contracts/generated");
mkdirSync(directory, { recursive: true });
output(`${directory}/schemas.json`, Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema, { target: "draft-7" })])));
output(`${directory}/otc-codebook.json`, { version: "hamming16-11-v1", codewords: Array.from({ length: 2048 }, (_, id) => encodeDeviceId(id)) });
output(`${directory}/otc-golden-packets.json`, [0, 1, 1023, 1024, 2047].map(deviceId => ({ deviceId, runTag: 37, symbolMs: 200, symbols: calibrationPacket(deviceId, 37, "otc-v1") })));
output(`${directory}/otc-v2-golden-packets.json`, [0, 1, 1023, 1024, 2047].map(deviceId => ({ deviceId, runTag: 37, packetVersion: "otc-v2", symbolMs: 250, symbols: calibrationPacket(deviceId, 37, "otc-v2") })));
console.log(check ? "Generated contracts and OTC vectors match." : "Generated schemas, codebook, and golden packets.");
