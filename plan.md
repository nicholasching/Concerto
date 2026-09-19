# Plan: build the admin console

This is the working plan for building the **admin console** — the operator screen that runs the
"Audience Orchestra" concert. It is written in plain language. The source of truth for the big
picture is `masterplan.md`; this file is just our focused, plain-language plan for one part of it.

## What the admin console does

One person (the operator) uses this screen to run the show. Across the night they do five things:

1. **Session** — show the QR code the audience scans to join, and watch counts of how many
   phones are connected, clock-synced, audio-unlocked, and located on the map. Keep a big mute
   button always visible.
2. **Calibration** — a short flashing test that figures out where each phone is sitting. The
   operator sets up three camera recordings, arms the test, watches a countdown, uploads the
   recordings, and waits for processing.
3. **Review** — look at the resulting audience map (dots for each phone), check which phones were
   found / fuzzy / missed, fix a column or orientation if needed, and commit the map.
4. **Assign** — draw boxes or freehand shapes on the map to pick groups of phones, assign each
   group to one of the musical channels, preview the count, and schedule the change.
5. **Perform** — run a four-lane timeline (one lane per channel), play / pause / stop / seek,
   adjust gains, mute / solo, and watch a shared playhead and ready counts.

That list is the whole feature. Nothing more, nothing less.

## How we will work (the workflow you asked for)

1. **This plan file first** (you are reading it).
2. **A subplot.** Before writing any real code, we write a detailed, plain-language spec for the
   admin console, pulled from `masterplan.md` and `rules.md`. It lives in `.devcontext/` next to
   the existing team notes. You review it. **We do not implement until you say the subplot looks
   good.**
3. **Implement off the subplot**, one small slice at a time. Each slice is testable on its own and
   gets committed with a clear message. After each slice we update the team notes.

## The separate mock app (so we can test without other teams)

You want the console testable on its own, with fake inputs fed in from outside. This is also what
the masterplan tells us to do ("build against a deterministic mock immediately").

- There is already a small mock server in `tools/admin-demo/` that serves a fake 1,500-phone
  snapshot. We will grow it into a full **fake-input harness**: a standalone app that feeds the
  console fake selections, fake camera uploads, fake job progress, fake assignments, and a fake
   shared clock — all on a local port, no real server needed.
- The console talks to this harness through one typed adapter. Later, the real server drops in
  behind the same adapter and nothing else changes.
- Run it with `bun run dev:admin-demo` (console on `3001`, fake-input harness on `18084`).
- Check it with `bun run gate:admin`.

This means a second process runs alongside the console purely to test it. The console never knows
whether it is talking to the fake harness or the real server.

## Branch

We rebuild the `feat/admin-console` branch from `main` (which is the `foundation-v1` baseline,
`ab59c27`). All admin work lives there and owns only `admin-frontend/`, `packages/selection/`, and
`tools/admin-demo/`. Shared files are not touched without the captain.

## The slices (small, testable steps)

In order — each one is a verifiable step, and matches the stage brief:

1. **Selection math** — pure functions that turn a drawn shape (box or freehand) into an explicit
   list of phone IDs plus the map version. Tested on its own, no UI. Verify: orientation, edges,
   fuzzy/missed phones, no duplicates, fast with 1,500 points.
2. **Typed adapter** — one module the console uses to talk to the server/harness. Shows server
   errors, keeps "pending" vs "confirmed" state separate, refreshes on a stale map. Never fakes
   success. Verify against the harness.
3. **Calibration** — prepare / ready / arm, three camera slots, upload progress vs processing
   progress, anchors, review rejects, commit the map. One bad camera does not lose the others.
4. **Assignment** — region / column preview, counts, channel, scheduled ID set, clear, manual
   fallback, one-step undo.
5. **Timeline** — shared playhead from the clock, four lanes, clips, play/pause/stop/seek,
   gain/mute/solo, ready counts, panic. We use the shared clock; we do not build a second one.
6. **Full walkthrough** — incomplete map, retry, reconnect, stale selection, panic — measured.

## What "done" looks like for the first step

A subplot spec in `.devcontext/` that you have approved. No code yet.

## Rules we follow

From `rules.md`: think before coding, keep it simple, change only what we must, define a success
check for each step, write semantic commits, keep the team notes current, and keep the mock out of
the production path. From `masterplan.md`: build the operator workflow (not a full music editor),
keep selection pure, render 1,500 dots without rerendering everything, and never show a local
change as success before the server confirms it.
