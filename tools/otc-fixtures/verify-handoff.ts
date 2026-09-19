// Exercise the real Python CLI using the same Zod schemas as the TS consumers.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { AdminSnapshot, AudienceMap, CalibrationManifest, JobProgress, OtcResult } from "@orchestra/contracts";
import { pythonExecutable, ROOT } from "../../scripts/run";

const python = pythonExecutable();
await mkdir(join(ROOT, "runtime"), { recursive: true });
const directory = await mkdtemp(join(ROOT, "runtime", "otc-handoff-"));

async function invoke(args: string[]) {
  const child = Bun.spawn([python, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

const generated = await invoke(["tools/otc-fixtures/generate.py", "--output-dir", directory, "--count", "30", "--seed", "7"]);
assert.equal(generated.exitCode, 0, generated.stderr);
const manifestPath = join(directory, "manifest.json");
const manifest = CalibrationManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
for (const camera of manifest.cameras) camera.videoPath = basename(camera.videoPath);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
const output = join(directory, "result.json");
const jobId = "handoff-audit";
const args = ["-m", "otc", "process", "--manifest", manifestPath, "--output", output,
  "--evidence", "synthetic", "--job-id", jobId, "--debug-dir", join(directory, "debug")];
const processed = await invoke(args);
assert.equal(processed.exitCode, 0, processed.stderr);
const events = processed.stdout.trim().split(/\r?\n/).map(line => JobProgress.parse(JSON.parse(line)));
assert.equal(events.at(-1)?.stage, "complete");
assert.equal(events.at(-1)?.progress, 1);
for (let i = 0; i < events.length; i++) {
  assert.equal(events[i].jobId, jobId);
  assert.equal(events[i].runId, manifest.runId);
  assert.ok(i === 0 || events[i].progress >= events[i - 1].progress);
}
const result = OtcResult.parse(JSON.parse(await readFile(output, "utf8")));
for (const key of ["protocolVersion", "sessionId", "serverEpoch", "runId", "runTag"] as const) {
  assert.equal(result[key], manifest[key]);
}
assert.equal(result.evidence, "synthetic");
assert.deepEqual(result.inputHashes, manifest.cameras.map(({ cameraId, sha256 }) => ({ cameraId, sha256 })));
assert.deepEqual(result.locations.map(location => location.deviceId), manifest.participantIds);
const truth: { phones: { deviceId: number; x: number; y: number; column: string }[] } =
  JSON.parse(await readFile(join(directory, "ground-truth.json"), "utf8"));
let maxPositionError = 0;
for (const location of result.locations) {
  assert.equal(location.status, "localized");
  assert.notEqual(location.x, null);
  assert.notEqual(location.y, null);
  const expected = truth.phones.find(phone => phone.deviceId === location.deviceId);
  assert.ok(expected);
  assert.equal(location.column, expected.column);
  const error = Math.hypot(location.x! - expected.x, location.y! - expected.y);
  assert.ok(error < .015, `Incorrect position for ID ${location.deviceId}: ${error}`);
  maxPositionError = Math.max(maxPositionError, error);
}
const audienceMap = AudienceMap.parse({ mapRevision: 1, runId: result.runId,
  evidence: result.evidence, locations: result.locations });
const snapshot = JSON.parse(await readFile(join(ROOT, "fixtures", "admin-snapshot.json"), "utf8"));
AdminSnapshot.parse({ ...snapshot, sessionId: result.sessionId, serverEpoch: result.serverEpoch, audienceMap });
const debug = JSON.parse(await readFile(join(directory, "debug", "index.json"), "utf8"));
assert.deepEqual(debug.finalObservations, result.observations);
assert.deepEqual(debug.locations, result.locations);

// A consumer must treat failure as failure, even after receiving valid progress.
const badManifest = structuredClone(manifest);
badManifest.cameras[0].sha256 = "0".repeat(64);
const badPath = join(directory, "bad-manifest.json");
await writeFile(badPath, JSON.stringify(badManifest));
const failedOutput = join(directory, "failed-result.json");
const failed = await invoke(["-m", "otc", "process", "--manifest", badPath,
  "--output", failedOutput, "--evidence", "synthetic", "--job-id", jobId]);
assert.equal(failed.exitCode, 2);
assert.match(JSON.parse(failed.stderr).error, /SHA-256 mismatch/);
assert.equal(existsSync(failedOutput), false);
const failedEvents = failed.stdout.trim().split(/\r?\n/).map(line => JobProgress.parse(JSON.parse(line)));
assert.deepEqual(failedEvents.map(event => event.stage), ["validate"]);

const summary = { protocolVersion: 1, decoderVersion: result.decoderVersion, evidence: result.evidence,
  participantCount: manifest.participantIds.length, localizedCount: result.locations.length,
  cameraCount: result.cameras.length, progressEvents: events.length, maxPositionError,
  processingMs: result.processingMs, hashFailureExit: failed.exitCode,
  checked: ["relative video paths", "CalibrationManifest", "JobProgress NDJSON", "OtcResult",
    "run identity and hashes", "AudienceMap", "AdminSnapshot map insertion", "debug consistency",
    "30 known positions including ID 0", "hash failure without output or complete event"],
};
await writeFile(join(directory, "handoff-check.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, directory }, null, 2));
