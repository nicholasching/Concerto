# Subplot: build the admin console (plain-language spec)

This is the plan for building the **admin console** — the screen one operator uses to run the
"Audience Orchestra" concert. It is written in plain words on purpose. The big-picture plan is
`masterplan.md`; this file is just our focused spec for the admin part.

> **Revision note (2026-09-19):** The fake-input harness described in section 2 was built, then
> removed at the user's direction. The console now talks to the **real** control server (Team 1,
> port 8080) only. When the real server isn't running, every action attempts the real call and
> shows a clean "Real server not detected" error in its catch block — nothing is faked. Section 2
> is kept as the original spec for history; the live behavior is "real server, graceful failure."

Workflow we follow: **spec first, you review it, then we build slice by slice.** No feature code
until you approve this spec. After that, each slice is a small, testable step with a success check
you can run yourself.

## 1. Overview — what the admin console is

One person runs the whole show from this screen. Across the night they do five things, in order:

1. **Session** — Show the QR code the audience scans to join. Watch live counts: how many phones
   are connected, clock-synced, audio-unlocked, and located on the map. Keep a big mute button
   always on screen.
2. **Calibration** — A short flashing test that figures out where each phone is sitting. The
   operator sets up three camera recordings, gets phones ready, arms the test, watches a
   countdown, the phones flash, then the operator uploads the three recordings and waits for
   processing.
3. **Review** — Look at the audience map: one dot per phone. See which phones were found well,
   found roughly, unclear, or missed. Fix a phone's column or the map's orientation if needed,
   look at the evidence, and commit the map as the new official layout.
4. **Assign** — Draw boxes or freehand shapes on the map to pick groups of phones. Assign each
   group to one musical channel. Preview the count, schedule the change, and keep a one-step undo
   for mistakes.
5. **Perform** — Run a four-lane timeline (one lane per channel). Play, pause, stop, seek. Adjust
   how loud each channel is, mute or solo a lane. Watch a shared playhead and how many phones are
   ready for the next cue.

That is the whole feature. We build exactly this, nothing more.

## 2. How we test on our own (the fake-input harness)

You want the console testable without the real server or the other teams. The masterplan tells us
to do this too: "build against a deterministic mock immediately." So a **second local process** runs
alongside the console and feeds it fake inputs.

- Today there is a tiny mock in `tools/admin-demo/` that serves a fake 1,500-phone snapshot on port
  `18084`. We grow it into a full **fake-input harness**: it feeds the console fake selections,
  fake camera uploads, fake job progress, fake assignments, and a fake shared clock. All local, no
  real server, no other teams needed.
- **No real files needed to test.** The operator screen's "upload camera recording" step will not
  require a real video. The harness accepts a fake upload without a real file behind it: you hit an
  "insert fake camera" button (or pick any dummy file), the console sends the request, and the
  harness streams fake `JobProgress` (queued → decode → complete over a couple seconds) then hands
  back a made-up audience map. You get the full flow — three uploads → fake processing → colored
  map → review → commit — with zero real camera files and zero real decoding. The map is honestly
  labeled `synthetic`; we never pass fake data off as real optical results.
- The console never talks to the server directly. It goes through one **typed adapter** — a small
  module that is the only thing that knows how to call the server. The adapter has two wirings:
  one for the fake harness (for building and testing) and one for the real server (later). The rest
  of the console does not care which one is active.
- Two rules the adapter always enforces: (a) show server errors honestly, and (b) keep
  **pending** (sent, not yet confirmed) state separate from **confirmed** state. The console never
  shows a local change as a success before the server confirms it. If the map is stale, it
  refreshes the official state instead of pretending.
- Run it: `bun run dev:admin-demo` — console on `3001`, fake-input harness on `18084`.
- Check it: `bun run gate:admin`.

## 3. The slices (small, testable steps)

Each slice builds on the last. Each has a success check you can run.

**Slice 1 — Selection math (pure, no UI).**
What: Pure functions that turn a drawn shape (a box or a freehand outline) into an explicit list of
phone IDs plus the map version it was drawn on. No React, no canvas, no network — just math.
Files: `packages/selection/src/`.
Success check: `bun run gate:admin` passes new tests for: audience-left orientation (the map's left
is the audience's left while facing the stage), edge cases (dots on the border count or not as
chosen), filtering out unclear/missed phones, no duplicate IDs, and speed with 1,500 dots.

**Slice 2 — Typed adapter.**
What: The one module the console uses to talk to the server/harness. Shows server errors, keeps
pending vs confirmed state separate, refreshes on a stale map, never fakes success.
Files: `admin-frontend/src/lib/adapter.ts` (new), plus fake-input harness routes in `tools/admin-demo/`.
Success check: `bun run gate:admin` — adapter tests cover server accept, server error, pending vs
confirmed, and stale-map refresh; all pass against the harness.

**Slice 3 — Calibration.**
What: The full calibration flow — prepare, ready, arm, countdown, three camera upload slots,
upload progress shown separate from processing progress, anchors and rotation, review of rejected
phones, and commit the map. One failed camera does not erase the other two uploads.
Files: `admin-frontend/src/app/calibration/` (new), `admin-frontend/src/lib/calibration.ts` (new),
harness upload/job routes in `tools/admin-demo/`.
Success check: `bun run dev:admin-demo`, walk through three uploads to a committed map; one upload
fails on purpose and the other two stay. `bun run gate:admin` passes.

**Slice 4 — Assignment.**
What: Draw a region or pick a column, preview the count, assign to a channel, schedule the change
at a future time, clear an assignment, manual fallback for unknown phones, and a one-step restore
of the previous set.
Files: `admin-frontend/src/app/assign/` (new), `admin-frontend/src/lib/assignment.ts` (new),
harness assignment routes.
Success check: `bun run dev:admin-demo`, select a region, assign it, preview the count, schedule
it, and undo it. `bun run gate:admin` passes.

**Slice 5 — Timeline (Perform).**
What: A shared playhead driven by the shared clock (we use the one from `packages/sync/`; we do not
build a second clock), four lanes, clip blocks, play/pause/stop/seek, gain, mute/solo, ready
counts, a pending countdown, and a persistent panic button.
Files: `admin-frontend/src/app/perform/` (new), `admin-frontend/src/lib/timeline.ts` (new),
harness transport/mix routes.
Success check: `bun run dev:admin-demo`, play the timeline, the playhead moves on all four lanes
from the shared clock, seek jumps it, panic stops everything. `bun run gate:admin` passes.

**Slice 6 — Full walkthrough.**
What: The whole operator flow end to end against the harness, including the hard cases: incomplete
map, retry, reconnect, stale selection, and panic. Measure that selection stays fast.
Files: a walkthrough test in `tools/admin-demo/` and notes in `.devcontext/`.
Success check: `bun run gate:admin` runs the full walkthrough and passes; interaction speed is
recorded in the team notes.

## 4. Data shapes we rely on (plain words)

These are the exact wire shapes already frozen in `packages/contracts/`. We use them as-is; we do
not invent our own.

- **AdminSnapshot** — the whole picture the console shows: the show, the transport state, the
  audience map, every phone's readiness, and current assignments, all at one revision.
- **AudienceMap** — the committed phone layout: a map version and one entry per phone.
- **Location** — one phone's spot: its ID, column, whether it was found well (`localized`), roughly
  (`coarse`), unclearly (`ambiguous`), or not seen (`unseen`), plus its normalized x/y on the map.
- **Channel** — one musical lane: an ID, label, color, gain, mute, and solo.
- **Clip** — one piece of audio placed on the timeline: which channel, which track, when it
  starts, how long, and its gain.
- **Transport** — whether the show is stopped, paused, or playing, plus the playhead position and
  the revision it was set at.
- **PendingAction** — a change that was sent but not yet in effect: a transport change, an
  assignment change, or a mix change, each with the future time it takes effect.
- **CalibrationPlan / CalibrationRun** — the flashing test's settings (which phones, colors, run
  tag) and, when armed, the scheduled start time.
- **JobProgress** — how far an offline processing job has gotten, from queued to complete or
  failed.
- **AssignmentRequest / TransportRequest / MixRequest** — the commands the console sends to change
  assignments, transport, and mix.

## 5. Out of scope (what we are NOT building)

- No full music editor (no DaVinci-style editing beyond clip drag/trim while stopped).
- No second clock — we use the shared one from `packages/sync/`.
- No real video decoding here — that is Team 3's job; we only show their results.
- No account system, no user login beyond the one operator.
- No touching other teams' files (`backend/`, `client-frontend/`, `packages/contracts/`,
  `packages/testkit/`, root scripts, lockfile) without the captain.
- No real phones, real cameras, or real venue tests in this branch — those are physical checks
  recorded separately, not scaffold-gated.

## 6. What proves your part works

There are two kinds of proof, and we keep them separate on purpose.

**Proof we CAN get from this branch alone (the "it works" signal):**

- **An automated gate you run yourself:** `bun run gate:admin`. It runs selection math tests,
  adapter tests, and contract checks. If it passes, the logic is verified — geometry orientation,
  edges, pending vs confirmed, stale-map handling. Deterministic; runs every slice.
- **A visual, clickable walkthrough you drive yourself:** `bun run dev:admin-demo`, then open
  `:3001` in your browser and do the whole flow by hand: see 1,500 fake dots colored by status,
  insert three fake cameras → watch fake processing → see the map recolor, draw a box → see the
  selected phones highlight with a count, assign to a channel → watch the count move pending then
  confirmed, hit play → the playhead moves across four lanes, hit panic → everything stops. This
  is real React rendering, real network calls, real schema parsing — only the data is fake. A
  screenshot or screen recording of this is valid evidence that the admin console works.

**Proof we CANNOT get from this branch (and must not claim):**

- That **real phones** play the right sound at the right time — a physical test with real devices,
  owned by Teams 1 and 2, done at the venue.
- That **real camera footage** decodes into correct phone positions — Team 3's physical test with
  real recordings.
- That **1,500 real phones** stay in sync over real venue Wi-Fi — a load plus venue rehearsal.

For the admin console specifically, "your part works" means the **operator workflow** — the
screen, the selection, the state handling, the timeline controls. That is fully provable on this
branch with the gate plus the visual walkthrough above. The downstream physics (sound, real
decoding, real network) belong to other teams and real hardware, and are a later, shared,
explicitly-labeled step — not something this branch produces or pretends.

## 7. Done means

The console is done when, against the fake-input harness, one operator can walk the whole flow:
**three uploads → a colored audience map → draw a selection → assign it to a channel → a moving
four-lane playhead** — and the hard cases (incomplete map, retry, reconnect, stale selection,
panic) all behave correctly. Selection stays fast with 1,500 dots. Pending and confirmed state
are always shown distinctly; nothing is shown as success before the server confirms it.

Passing the foundation scaffold is **not** feature completion. The scaffold only proves the
shells and shapes exist; the interactive workflow is the work this spec describes.

---

Branch: `feat/admin-console`, rebuilt from `main` (the `foundation-v1` baseline, commit
`ab59c27`). We own only `admin-frontend/`, `packages/selection/`, and `tools/admin-demo/`.
