import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PROTOCOL_VERSION } from "@orchestra/contracts";
import { SimulatedClient } from "./client";
import { formatSummary, rate, summarize } from "./metrics";

const argument = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const clients = Number(argument("clients", "50"));
const durationSeconds = Number(argument("duration", "30"));
const baseUrl = argument("url", "http://127.0.0.1:8080");
const sessionId = argument("session", "dev-session");
const secret = process.env.OPERATOR_SECRET ?? "";
const reportPath = argument("report", ".devcontext/evidence/sync-control/load-run.md");

const operator = async (path: string, body: Record<string, unknown>, method = "POST") => {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { "content-type": "application/json", "x-operator-secret": secret },
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, sessionId, serverEpoch: epoch, ...body }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};
const snapshot = async () =>
  (await fetch(`${baseUrl}/api/sessions/${sessionId}/snapshot`, { headers: { "x-operator-secret": secret } })).json();
const diagnostics = async () => (await fetch(`${baseUrl}/api/foundation`)).json();
const jobView = async (jobId: string) =>
  (await fetch(`${baseUrl}/api/jobs/${jobId}`, { headers: { "x-operator-secret": secret } })).json();

const show = {
  showId: "load-show", showRevision: 0, label: "Load run",
  tracks: [{
    trackId: "track-1", label: "Melody", url: "/api/assets/track-1", sha256: "a".repeat(64),
    byteSize: 1024, durationMs: 300_000, sampleRateHz: 48_000, channels: 2,
  }],
  channels: [
    { channelId: "melody", label: "Melody", color: "#3b82f6", gain: 1, mute: false, solo: false },
    { channelId: "bass", label: "Bass", color: "#ef4444", gain: 1, mute: false, solo: false },
  ],
  clips: [{ clipId: "clip-1", channelId: "melody", trackId: "track-1", timelineStartMs: 0, sourceOffsetMs: 0, durationMs: 300_000, gain: 1 }],
};

console.log(`Load run: ${clients} clients for ${durationSeconds}s against ${baseUrl}`);
if (!secret) console.warn("OPERATOR_SECRET is unset; operator steps will be refused.");

const probe = await fetch(`${baseUrl}/api/sessions/${sessionId}/join`, {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}",
});
if (!probe.ok) throw new Error(`Backend is not reachable at ${baseUrl}`);
const epoch = (await probe.json()).serverEpoch;

// Join wave: every client arrives at once, the way an audience scans a QR code together.
const started = performance.now();
const simulated = Array.from({ length: clients }, (_, index) =>
  new SimulatedClient(baseUrl, sessionId, 50 + (index % 20) * 25));
await Promise.all(simulated.map(client => client.join()));
const joinWaveMs = performance.now() - started;
await Promise.all(simulated.map(client => client.connect()));
for (const client of simulated) client.start();
const connectedMs = performance.now() - started;
const peakDiagnostics = await diagnostics();
console.log(`Join wave: ${joinWaveMs.toFixed(0)} ms to join, ${connectedMs.toFixed(0)} ms to hold sockets`);

await Bun.sleep(3000);

// Contention: an asset upload and an OTC process run while the cue is prepared and delivered.
const bytes = new Uint8Array(8 * 1024 * 1024);
const uploadQuery = new URLSearchParams({
  commandId: "load-asset", label: "load stem", byteSize: String(bytes.byteLength),
  durationMs: "300000", sampleRateHz: "48000", channels: "2",
});
const uploading = fetch(`${baseUrl}/api/assets?${uploadQuery}`, {
  method: "POST", headers: { "x-operator-secret": secret }, body: bytes.buffer as ArrayBuffer,
});

const calibrationIds = simulated
  .map(client => client.result.deviceId)
  .filter(deviceId => deviceId >= 0)
  .slice(0, Math.min(30, clients));
const calibration = await operator("/api/calibrations", {
  commandId: "load-calibration", expectedRevision: 0, participantIds: calibrationIds,
  palette: { zero: "#1020ff", one: "#ff2010", neutral: "#101010" },
  paletteVersion: "load-palette-v1",
});
if (calibration.status !== 200) throw new Error(`Calibration creation failed: ${JSON.stringify(calibration.body)}`);
await Bun.sleep(750);

const calibrationSnapshot = await snapshot();
const runId = calibration.body.plan.runId as string;
const preparationId = calibration.body.preparationId as string;
const armed = await operator(`/api/calibrations/${runId}/arm`, {
  commandId: "load-calibration-arm", expectedRevision: 0, runId, preparationId,
  effectiveServerMs: calibrationSnapshot.serverMs + 5000,
});
if (armed.status !== 200) throw new Error(`Calibration arm failed: ${JSON.stringify(armed.body)}`);

const cameraBytes = new Uint8Array(16 * 1024 * 1024);
const cameraQuery = new URLSearchParams({
  commandId: "load-camera", cameraId: "load-camera-left", primaryColumn: "left",
  rotationDegrees: "0", byteSize: String(cameraBytes.byteLength), label: "synthetic-load-camera.mp4",
});
const cameraResponse = await fetch(`${baseUrl}/api/calibrations/${runId}/uploads?${cameraQuery}`, {
  method: "POST", headers: { "x-operator-secret": secret }, body: cameraBytes.buffer as ArrayBuffer,
});
const camera = await cameraResponse.json();
if (!cameraResponse.ok) throw new Error(`Camera upload failed: ${JSON.stringify(camera)}`);

const job = await operator(`/api/calibrations/${runId}/jobs`, {
  commandId: "load-job", expectedRevision: 0, runId, uploadIds: [camera.uploadId],
});
if (job.status !== 200) throw new Error(`Job creation failed: ${JSON.stringify(job.body)}`);
const jobId = job.body.jobId as string;

await operator("/api/show", { commandId: "load-show", expectedRevision: 0, show }, "PUT");
const afterShow = await snapshot();
await operator("/api/transport", {
  commandId: "load-prepare", expectedRevision: afterShow.transport.transportRevision,
  action: "prepare", showRevision: afterShow.show.showRevision, positionMs: 0, effectiveServerMs: 0,
});

await Bun.sleep(2000);
const beforeCue = await snapshot();
const effectiveServerMs = beforeCue.serverMs + 5000;
for (const client of simulated) client.noteCueDeadline(effectiveServerMs);
const workerStageAtCue = (await jobView(jobId)).progress.stage as string;
const cue = await operator("/api/transport", {
  commandId: "load-play", expectedRevision: beforeCue.transport.transportRevision,
  action: "play", showRevision: beforeCue.show.showRevision, positionMs: 0, effectiveServerMs,
});
console.log(`Cue scheduled: ${cue.status}`);

// A tenth of the room drops and comes back while the cue is in flight.
const reconnecting = simulated.filter((_, index) => index % 10 === 0);
await Promise.all(reconnecting.map(client => client.reconnect()));

const assignmentIds = simulated
  .map(client => client.result.deviceId)
  .filter(deviceId => deviceId >= 0)
  .slice(0, 1000);
await operator("/api/assignments", {
  commandId: "load-assign", expectedRevision: 0, mapRevision: 0,
  deviceIds: assignmentIds,
  channelId: "bass", effectiveServerMs: effectiveServerMs + 2000,
});
const assetResponse = await uploading;
if (!assetResponse.ok) throw new Error(`Asset upload failed with ${assetResponse.status}`);

const remainingMs = durationSeconds * 1000 - (performance.now() - started);
if (remainingMs > 0) await Bun.sleep(remainingMs);

const finalSnapshot = await snapshot();
const finalDiagnostics = await diagnostics();
const finalJob = await jobView(jobId);
for (const client of simulated) client.stop();
const results = simulated.map(client => client.result);
const joined = results.filter(result => result.deviceId >= 0);
const acknowledged = results.filter(result => result.acknowledgedPreparation);
const beforeDeadline = results.filter(result => result.acknowledgedBeforeDeadline);
const margins = results.map(result => result.cueMarginMs).filter((value): value is number => value !== null);
const knewAboutCue = results.filter(result => result.cueLearnedFrom !== null);
const viaSnapshot = results.filter(result => result.cueLearnedFrom === "snapshot");
const errors = results.flatMap(result => result.errors);
const exclusions = results.filter(result => !result.acknowledgedBeforeDeadline);
const committedAssignments = finalSnapshot.assignments.filter(
  (assignment: { channelId: string | null }) => assignment.channelId === "bass",
).length;

const report = [
  "# Control load run",
  "",
  `Date: ${new Date().toISOString()}`,
  `Clients requested: ${clients}. Duration: ${durationSeconds}s. Target: ${baseUrl}`,
  "",
  "## Result",
  "",
  `- Clients that joined: ${rate(joined.length, clients)}`,
  `- Join wave: ${joinWaveMs.toFixed(0)} ms to join, ${connectedMs.toFixed(0)} ms until every socket was open`,
  `- Acknowledged the preparation: ${rate(acknowledged.length, joined.length)}`,
  `- Acknowledged before the cue deadline: ${rate(beforeDeadline.length, joined.length)}`,
  `- Clock ready when acknowledging preparation: ${rate(results.filter(r => r.clockReadyWhenAcknowledged).length, joined.length)}`,
  `- Knew about the cue by its moment: ${rate(knewAboutCue.length, joined.length)}`,
  `-   of which recovered it from a snapshot after reconnecting: ${viaSnapshot.length}`,
  `- ${formatSummary("Cue margin (warning before the moment)", summarize(margins))}`,
  `- ${formatSummary("Join latency", summarize(joined.map(result => result.joinMs)))}`,
  `- Reconnected mid-run: ${reconnecting.length}`,
  `- Joins shed by the rate limiter and retried: ${results.reduce((total, result) => total + result.joinRetries, 0)}`,
  `- Sockets that needed a retry to open: ${results.filter(result => result.connectRetries > 0).length}`,
  `- Client-side errors: ${errors.length}`,
  `- Worker stage when the cue was sent: ${workerStageAtCue}`,
  `- Worker final stage: ${finalJob.progress.stage}`,
  `- Worker diagnostics: ${finalJob.diagnostics.length}`,
  `- Connected sockets immediately after the join wave: ${peakDiagnostics.diagnostics.connectedDevices}`,
  `- Connected sockets at the end of the run, before teardown: ${finalDiagnostics.diagnostics.connectedDevices}`,
  `- Registered identities: ${finalDiagnostics.diagnostics.devices} (includes one reachability probe without a socket)`,
  `- Reassignment committed to bass: ${committedAssignments}/${assignmentIds.length} targeted devices`,
  `- Effective transport at the end: ${finalSnapshot.transport.status}`,
  "",
  "## Server event-loop delay",
  "",
  "Measured inside the control process. Delay here means sockets were waiting.",
  "",
  "```json",
  JSON.stringify(finalDiagnostics.diagnostics, null, 2),
  "```",
  "",
  "## What this does not show",
  "",
  "Every client here is a loopback socket on the same machine as the server. This measures whether",
  "the control process survives the connection count and still delivers cues on time. It says",
  "nothing about venue Wi-Fi, radio congestion, NAT tables in the access points, phones sleeping or",
  "backgrounding, or whether any sound was produced. No audio was played and no screen was rendered.",
  "A passing run here is a necessary condition for the concert, not evidence that it will work.",
  "",
  "## Exclusions and late clients",
  "",
  ...(exclusions.length === 0
    ? ["No client was excluded or late in this run.", ""]
    : exclusions.map(result =>
      `- Device ${result.deviceId}: ${result.errors.join("; ") || "did not acknowledge before the cue deadline"}`)),
  ...(errors.length > 0 ? ["## Errors observed", "", ...[...new Set(errors)].slice(0, 20).map(error => `- ${error}`), ""] : []),
].join("\n");

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, report, "utf8");
console.log(report.split("## What this does not show")[0]);
console.log(`Report written to ${reportPath}`);
process.exit(0);
