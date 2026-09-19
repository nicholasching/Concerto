import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AdminSnapshot, CalibrationManifest, ClientMessage, OtcResult, ParticipantSnapshot, ServerMessage, Show } from "../packages/contracts/src";

const check = process.argv.includes("--check");
function output(path: string, value: unknown) {
  const data = value instanceof Buffer ? value : Buffer.from(JSON.stringify(value, null, 2) + "\n");
  if (check) {
    const existing = readFileSync(path);
    if (!existing.equals(data) && !(path.endsWith(".json") && existing.toString().replaceAll("\r\n", "\n") === data.toString())) throw new Error(`Stale fixture: ${path}`);
  } else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); }
}

// Original low-amplitude test tones, not copied music. 8 seconds of mono PCM16.
function tone(frequency: number) {
  const sampleRate = 16000, samples = sampleRate * 8;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const envelope = Math.min(1, i / 160, (samples - i - 1) / 160);
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * i / sampleRate) * 3000 * envelope), 44 + i * 2);
  }
  return wav;
}
const labels = ["Percussion", "Bass", "Harmony", "Melody"];
const colors = ["#f59e0b", "#34d399", "#a78bfa", "#38bdf8"];
const tracks = labels.map((label, index) => {
  const wav = tone([220, 330, 440, 550][index]);
  output(`fixtures/media/tone-${index}.wav`, wav);
  return { trackId: `tone-${index}`, label: `${label} test tone`, url: `/api/assets/tone-${index}`, sha256: createHash("sha256").update(wav).digest("hex"), byteSize: wav.length, durationMs: 8000, sampleRateHz: 16000, channels: 1 };
});
const show = Show.parse({
  showId: "foundation-show", showRevision: 1, label: "Synthetic four-channel fixture",
  tracks, channels: labels.map((label, i) => ({ channelId: `channel-${i}`, label, color: colors[i], gain: 0.3, mute: false, solo: false })),
  clips: tracks.map((track, i) => ({ clipId: `clip-${i}`, channelId: `channel-${i}`, trackId: track.trackId, timelineStartMs: 0, sourceOffsetMs: 0, durationMs: 8000, gain: 1 })),
});
const identity = { protocolVersion: 1 as const, sessionId: "demo", serverEpoch: "fixture-epoch" };
const columns = ["left", "center", "right"] as const;
const baseLocation = (deviceId: number) => ({ deviceId, column: columns[deviceId % 3], sourceCameraIds: [`camera-${columns[deviceId % 3]}`], decodeScore: 0.98, mappingResidualPx: 1 });
const locations = Array.from({ length: 30 }, (_, deviceId) => deviceId < 27
  ? { ...baseLocation(deviceId), status: "localized", mappingMode: "manual-anchors", x: (deviceId % 3 + 0.5) / 3, y: (Math.floor(deviceId / 3) + 1) / 11 }
  : { ...baseLocation(deviceId), status: ["coarse", "ambiguous", "unseen"][deviceId - 27], mappingMode: deviceId === 27 ? "manual-column" : "none", x: null, y: null, decodeScore: null, mappingResidualPx: null, sourceCameraIds: [] });
const cameras = columns.map(column => ({ cameraId: `camera-${column}`, primaryColumn: column, videoPath: `runtime/captures/${column}.mp4`, sha256: createHash("sha256").update(`synthetic-${column}`).digest("hex"), rotationDegrees: 0, exclusionRois: [], anchors: [{ x: 100, y: 2000 }, { x: 3700, y: 2000 }, { x: 2800, y: 200 }, { x: 1000, y: 200 }] }));
const manifest = CalibrationManifest.parse({ ...identity, runId: "fixture-run", runTag: 37, participantIds: Array.from({ length: 30 }, (_, i) => i), startServerMs: 100000, packetVersion: "otc-v1", codebookVersion: "hamming16-11-v1", paletteVersion: "amber-blue-v1", palette: { zero: "#FFB000", one: "#0066FF", neutral: "#111111" }, symbolMs: 200, cameras });
const observations = locations.slice(0, 27).map(location => ({ cameraId: location.sourceCameraIds[0], trackId: `screen-${location.deviceId}`, deviceId: location.deviceId, status: "accepted", centerPx: { x: 1900, y: 200 + Math.floor(location.deviceId / 3) * 180 }, firstPtsMs: 0, lastPtsMs: 11000, decodeScore: 0.98, correctedBits: 0, erasedBits: 0, reasons: [] }));
const result = OtcResult.parse({ ...identity, runId: manifest.runId, runTag: manifest.runTag, evidence: "synthetic", decoderVersion: "fixture-only", inputHashes: cameras.map(({ cameraId, sha256 }) => ({ cameraId, sha256 })), observations: [...observations, { ...observations[0], trackId: "reflection-0", status: "rejected", centerPx: { x: 3800, y: 10 }, reasons: ["duplicate-reflection"] }], locations, cameras: cameras.map(({ cameraId }) => ({ cameraId, frameWidth: 3840, frameHeight: 2160, phasePtsMs: 0, acceptedTracks: 9, rejectedTracks: cameraId === "camera-left" ? 1 : 0, messages: ["Synthetic fixture; no captured video."] })), warnings: ["Synthetic hand-authored observations. MP4 paths and video hashes are placeholders, not recordings."], processingMs: 0 });
const devices = manifest.participantIds.map(deviceId => ({ deviceId, connected: true, foreground: true, clockReady: true, clockUncertaintyMs: 5, clockSampleAgeMs: 100, audioUnlocked: false, decodedTrackHashes: {} }));
const assignments = manifest.participantIds.map(deviceId => ({ deviceId, channelId: null, assignmentRevision: 0, mapRevision: 1 }));
const snapshot = AdminSnapshot.parse({ ...identity, revision: 1, serverMs: 90000, role: "admin", show, transport: { status: "stopped", transportRevision: 0, showRevision: 1, positionMs: 0, startServerMs: null }, pendingActions: [], audienceMap: { mapRevision: 1, runId: manifest.runId, evidence: "synthetic", locations }, devices, assignments });
const { audienceMap: _map, devices: _devices, assignments: _assignments, assignmentRevision: _ar,
  preparations: _preps, appliedCommandIds: _commands, calibration: _calibration, ...common } = snapshot;
const participant = ParticipantSnapshot.parse({ ...common, role: "participant", deviceId: 0, readiness: devices[0], assignment: assignments[0], location: snapshot.audienceMap.locations[0] });
const { cameras: _cameras, ...run } = manifest;
const { startServerMs: _start, ...plan } = run;
const client = ClientMessage.parse({ ...identity, messageId: "probe-0", type: "clock.probe", payload: { t0: 90000, probeGroupId: 0, probeGroupIndex: 0 } });
const messages = [
  { ...identity, messageId: "snapshot", type: "state.snapshot", revision: 1, payload: participant },
  { ...identity, messageId: "prepare", type: "calibration.prepare", revision: 2, payload: { preparationId: "prepare-1", plan } },
  { ...identity, messageId: "arm", type: "calibration.arm", revision: 3, effectiveServerMs: run.startServerMs, payload: { preparationId: "prepare-1", run } },
].map(value => ServerMessage.parse(value));
output("fixtures/show.json", show);
output("fixtures/admin-snapshot.json", snapshot);
output("fixtures/participant-snapshot.json", participant);
output("fixtures/otc/clean-30/manifest.json", manifest);
output("fixtures/otc/clean-30/result.json", result);
output("fixtures/client-message.json", client);
output("fixtures/server-messages.json", messages);
console.log(check ? "Synthetic fixtures match their generators." : "Generated deterministic media and boundary fixtures.");
