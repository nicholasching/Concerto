import { readFile } from "node:fs/promises";
import { AdminSnapshot, CommandAccepted, Track, type ShowData } from "@orchestra/contracts";

const baseUrl = process.env.API_URL ?? "http://localhost:8080";
const headers = { "x-operator-secret": process.env.OPERATOR_SECRET ?? "local-demo-only" };
const sessionId = process.env.SESSION_ID ?? "dev-session";
const snapshotResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/snapshot`, { headers });
if (!snapshotResponse.ok) throw new Error(`Operator snapshot failed: ${await snapshotResponse.text()}`);
const snapshot = AdminSnapshot.parse(await snapshotResponse.json());
if (snapshot.show.showId !== "placeholder") throw new Error("A show already exists. Use the operator editor to change it; seed-show will not overwrite it.");
const show: ShowData = JSON.parse(await readFile("fixtures/show.json", "utf8"));
const tracks: ShowData["tracks"] = [];
for (const source of show.tracks) {
  const bytes = await readFile(`fixtures/media/${source.trackId}.wav`);
  const query = new URLSearchParams({ commandId: crypto.randomUUID(), label: source.label, byteSize: String(bytes.length), durationMs: String(source.durationMs), sampleRateHz: String(source.sampleRateHz), channels: String(source.channels) });
  const response = await fetch(`${baseUrl}/api/assets?${query}`, { method: "POST", headers, body: bytes });
  if (!response.ok) throw new Error(await response.text());
  tracks.push(Track.parse(await response.json()));
}
const registered = { ...show, showId: crypto.randomUUID(), label: "Original three-channel sound check", tracks,
  clips: show.clips.map(clip => ({ ...clip, trackId: tracks[show.tracks.findIndex(track => track.trackId === clip.trackId)].trackId })) };
const response = await fetch(`${baseUrl}/api/show`, { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({
  protocolVersion: 1, sessionId, serverEpoch: snapshot.serverEpoch, commandId: crypto.randomUUID(), expectedRevision: snapshot.show.showRevision, show: registered,
}) });
if (!response.ok) throw new Error(await response.text());
CommandAccepted.parse(await response.json());
console.log("Uploaded three original 8-second tones for Melody, Vocals and Percussion and saved the real show. Join phones, enable sound, choose columns, assign channels, prepare, then play.");
