import { expect, test } from "bun:test";
import { DEFAULT_SHOW_CHANNELS, Show, sectionChannelsFor, type ShowData } from "@orchestra/contracts";
import { addVocalsRight, forgetShowDraft, recoverShowDraft, rememberShowDraft, renameChannel } from "../src/lib/show-draft";
import fixture from "../../fixtures/show.json";

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
}
const saved: ShowData = { showId: "show", showRevision: 3, label: "Sound check", tracks: [], clips: [],
  channels: [{ channelId: "percussion", label: "Percussion", color: "#abcdef", gain: 1, mute: false, solo: false }] };

test("renaming all lanes preserves audio, IDs, mix and inferred section routes in a recoverable draft", () => {
  for (const labels of [["Melody", "Percussion", "Vocals Left", "Vocals Right"], ["Melody", "Vocals", "Percussion", "Percussion 2"]]) {
    const existing = Show.parse(fixture);
    existing.channels.forEach((channel, index) => { channel.label = labels[index]; });
    delete existing.sectionChannels;
    const before = structuredClone(existing);
    const routes = sectionChannelsFor(existing);
    const names = ["Guitar", "Bass", "Drums", "Harmony"];
    const draft = existing.channels.reduce((show, channel, index) => renameChannel(show, channel.channelId, names[index]), existing);
    expect(draft.channels.map(channel => channel.label)).toEqual(names);
    expect({ ...draft, channels: draft.channels.map((channel, index) => ({ ...channel, label: labels[index] })), sectionChannels: undefined })
      .toEqual({ ...before, sectionChannels: undefined });
    expect(sectionChannelsFor(draft)).toEqual(routes);
    expect(existing).toEqual(before);
    const storage = memoryStorage();
    rememberShowDraft("session", existing, draft, storage);
    expect(recoverShowDraft("session", existing, storage)).toEqual(draft);
    expect(addVocalsRight(draft)).toBe(draft);
  }
});

test("renaming retains explicit silent and shared section presets, even for duplicate labels", () => {
  const existing: ShowData = { ...Show.parse(fixture), sectionChannels: {
    left: null, "center-left": "channel-3", "center-right": "channel-3", right: "channel-0",
  } };
  const draft = renameChannel(renameChannel(existing, "channel-0", "Synth"), "channel-3", "Synth");
  expect(sectionChannelsFor(draft)).toEqual(sectionChannelsFor(existing));
  expect(draft.channels[0].channelId).not.toBe(draft.channels[3].channelId);
});

test("adding Vocals Right preserves an existing three-lane show and its recoverable draft", () => {
  const existing: ShowData = { ...Show.parse(fixture), channels: DEFAULT_SHOW_CHANNELS.slice(0, 3).map(channel => ({ ...channel, gain: 0.7, mute: false, solo: false })),
    clips: fixture.clips.filter(clip => clip.channelId !== "channel-3"), tracks: fixture.tracks.filter(track => track.trackId !== "tone-3"),
    sectionChannels: { left: "channel-0", "center-left": "channel-1", "center-right": null, right: "channel-2" },
    cueMarkers: [{ cueId: "cue", label: "Opening", positionMs: 2500 }] };
  const before = structuredClone(existing);
  const draft = addVocalsRight(existing);
  expect(Show.parse(draft).channels.map(channel => channel.label)).toEqual(["Melody", "Percussion", "Vocals Left", "Vocals Right"]);
  expect({ ...draft, channels: draft.channels.slice(0, 3) }).toEqual(before);
  expect(existing).toEqual(before);
  expect(addVocalsRight(draft)).toBe(draft);
  const storage = memoryStorage();
  rememberShowDraft("session", existing, draft, storage);
  expect(recoverShowDraft("session", existing, storage)).toEqual(draft);
});

test("Vocals Right addition avoids existing IDs and recognizes an already renamed lane", () => {
  const existing = { ...saved, channels: [{ ...saved.channels[0], channelId: "channel-3" }] };
  const draft = addVocalsRight(existing);
  expect(draft.channels[1].channelId).not.toBe("channel-3");
  expect(Show.safeParse(draft).success).toBe(true);
  expect(addVocalsRight({ ...saved, channels: [{ ...saved.channels[0], label: " Vocals Right " }] }).channels).toHaveLength(1);
});

test("unsaved music presets recover after an editor remount and clear only after save", () => {
  const storage = memoryStorage();
  const draft: ShowData = { ...saved, label: "Prepared for stage", sectionChannels: {
    left: "percussion", "center-left": null, "center-right": "percussion", right: null,
  }, cueMarkers: [{ cueId: "cue", label: "Opening", positionMs: 2500 }] };
  rememberShowDraft("session", saved, draft, storage);
  expect(recoverShowDraft("session", structuredClone(saved), storage)).toEqual(draft);
  expect(recoverShowDraft("different-session", saved, storage)).toBeNull();
  expect(recoverShowDraft("session", saved, storage)).toEqual(draft);
  forgetShowDraft("session", storage);
  expect(recoverShowDraft("session", saved, storage)).toBeNull();
});

test("a draft cannot replace a more recent saved revision or another show", () => {
  for (const replacement of [{ ...saved, showRevision: 4 }, { ...saved, showId: "another-show" }]) {
    const storage = memoryStorage();
    rememberShowDraft("session", saved, { ...saved, label: "Old edits" }, storage);
    expect(recoverShowDraft("session", replacement, storage)).toBeNull();
    expect(recoverShowDraft("session", saved, storage)).toBeNull();
  }
});

test("invalid or unavailable browser storage does not prevent editing or saving", () => {
  const storage = memoryStorage();
  rememberShowDraft("session", saved, { ...saved, showRevision: -1 }, storage);
  expect(recoverShowDraft("session", saved, storage)).toBeNull();
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };
  expect(() => rememberShowDraft("session", saved, saved, blocked)).not.toThrow();
  expect(recoverShowDraft("session", saved, blocked)).toBeNull();
  expect(() => forgetShowDraft("session", blocked)).not.toThrow();
});
