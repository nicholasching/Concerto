import { expect, test } from "bun:test";
import { ParticipantSnapshot } from "@orchestra/contracts";
import fixture from "../../fixtures/participant-snapshot.json";
import { participantStatus } from "../src/lib/status";

test("connection and clock do not imply audible readiness", () => {
  const snapshot = ParticipantSnapshot.parse(structuredClone(fixture));
  expect(participantStatus(snapshot)).toBe("Audio not enabled");
  snapshot.readiness.audioUnlocked = true;
  expect(participantStatus(snapshot)).toBe("No channel assigned");
  snapshot.assignment.channelId = snapshot.show.channels[0].channelId;
  expect(participantStatus(snapshot)).toBe("Assets not ready");
  const track = snapshot.show.tracks[0];
  snapshot.readiness.decodedTrackHashes[track.trackId] = track.sha256;
  expect(participantStatus(snapshot)).toBe("Prepared; playback implementation pending");
});
