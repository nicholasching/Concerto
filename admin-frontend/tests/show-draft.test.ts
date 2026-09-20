import { expect, test } from "bun:test";
import { type ShowData } from "@orchestra/contracts";
import { forgetShowDraft, recoverShowDraft, rememberShowDraft } from "../src/lib/show-draft";

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
}
const saved: ShowData = { showId: "show", showRevision: 3, label: "Sound check", tracks: [], clips: [],
  channels: [{ channelId: "percussion", label: "Percussion", color: "#abcdef", gain: 1, mute: false, solo: false }] };

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
