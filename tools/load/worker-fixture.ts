import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { CalibrationManifest, OtcResult } from "@orchestra/contracts";

const valueAfter = (flag: string): string => {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${flag}`);
  return value;
};

const manifestPath = valueAfter("--manifest");
const outputPath = valueAfter("--output");
const durationMs = Number(process.env.LOAD_WORKER_DURATION_MS ?? 8000);
const manifest = CalibrationManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));

// This is intentionally CPU-active rather than a sleep. It proves that the control process stays
// responsive while another process competes for the machine. It does not decode a pixel and its
// result is labelled synthetic.
const stages = ["validate", "decode", "track", "register"] as const;
for (let index = 0; index < stages.length; index++) {
  const stage = stages[index];
  const until = performance.now() + durationMs / stages.length;
  let digest = "load-worker";
  while (performance.now() < until) {
    digest = createHash("sha256").update(digest).digest("hex");
  }
  console.log(JSON.stringify({
    stage,
    progress: (index + 1) / (stages.length + 1),
    message: `${stage} synthetic fixture (${digest.slice(0, 8)})`,
  }));
}

const result = OtcResult.parse({
  protocolVersion: 1,
  sessionId: manifest.sessionId,
  serverEpoch: manifest.serverEpoch,
  runId: manifest.runId,
  runTag: manifest.runTag,
  evidence: "synthetic",
  decoderVersion: "load-worker-fixture-v1",
  inputHashes: manifest.cameras.map(camera => ({
    cameraId: camera.cameraId,
    sha256: camera.sha256,
  })),
  observations: [],
  locations: [],
  cameras: manifest.cameras.map(camera => ({
    cameraId: camera.cameraId,
    frameWidth: 3840,
    frameHeight: 2160,
    phasePtsMs: 0,
    acceptedTracks: 0,
    rejectedTracks: 0,
    messages: ["Synthetic load fixture; no video was decoded."],
  })),
  warnings: ["Synthetic load fixture; this is not optical evidence."],
  processingMs: durationMs,
});

await writeFile(outputPath, JSON.stringify(result), "utf8");
console.log(JSON.stringify({ stage: "complete", progress: 1, message: "synthetic fixture complete" }));
