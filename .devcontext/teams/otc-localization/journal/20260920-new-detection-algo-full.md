# Merge current phone detection with updated main

Date / author: 2026-09-20 / Codex (Team 3 scope)
Status: in progress

## Goal and baseline

- User requested a branch named `new-detection-algo-full` containing the current
  `phone-detection` red/blue detector alongside the latest `origin/main` OTC
  performance upgrades.
- Started from clean `phone-detection` at `8361ca3`; fetched
  `origin/main` at `3ea56f3`; common ancestor is `7cbe031`.
- New branch starts from `origin/main`; foundation baseline is
  `ab59c27105627977ee52dc2bcd4276b4532b9e2a`.

## Scope and assumption

The current branch implements its detector in `otc box-video` (`boxing.py`,
`red_blue_diagnostic.py`, its tests, and the isolated `debug_phone/` bench).
It does not replace the normal `otc process` identity-decoding pipeline.
This integration preserves both paths exactly: the normal process path keeps
main's bounded parallel frame analysis, while `box-video` keeps the current
red/blue temporal detector.

## Merge and verification plan

1. Merge all current-branch commits into updated `origin/main`, retaining both
   CLI additions in `workers/otc/src/otc/__main__.py`.
2. Verify the merge commits contain both parents and the composed CLI exposes
   both `process --cpu-budget` and `box-video --verbose-output-dir`.
3. Run `bun run gate:otc` and the debug-phone packet test. Record actual
   outcomes and any pre-existing failure separately.

## Initial composed checks

- `python -m otc --help`, `python -m otc process --help`, and `python -m otc
  box-video --help` expose both command additions.
- `python -m pytest workers/otc/tests/test_boxing.py -q` passed: 11 tests.
- The first `bun test debug_phone/packet.test.ts` run failed because main now
  defaults its exported timing constants and packet helper to `otc-v2`.
  The imported branch bench is explicitly the legacy 55-slot, 200 ms packet;
  its own implementation was unchanged. The test is therefore made explicit
  about `otc-v1` and uses the bench's own 55-slot timing exports. This is a
  compatibility assertion, not a detector behavior change.
- Re-run `bun test debug_phone/packet.test.ts` passed: 3 tests and 37
  assertions.
- `bun run gate:otc` completed successfully after the merge. It ran generated
  contract/fixture checks, boundary isolation, TypeScript, lint, contract
  tests, worker Ruff, and the full OTC Python suite. This is software evidence
  only; no new camera/phone physical test was performed.

## Handoff

- The merge parent from `origin/main` carries bounded per-frame CPU parallelism
  (`process --cpu-budget`) and its newer production tracking/protocol work.
- The `phone-detection` parent carries the exact local `box-video` red/blue
  temporal detector, verbose masks, focused tests, and `debug_phone` bench.
- The only composed file is `workers/otc/src/otc/__main__.py`, which exposes
  both independent command additions. The debug bench test explicitly checks
  its legacy `otc-v1` packet to prevent future default-version drift.
- Physical camera evidence, and any decision to replace the normal production
  identity-decoding path with the diagnostic `box-video` path, remain outside
  this merge and require an explicit follow-up.

## Scope correction

The user clarified that this branch must make the normal OTC worker use the
complete `phone-detection` algorithm, not merely expose it beside the old
pipeline. The intended behavior is the current red/blue palette-only detector
with its ordered red-blue-red-blue qualification and session recovery. The
user explicitly does not require legacy amber-hue compatibility. The next
change will remove the generic screen detector from the production red/blue
path while retaining main's bounded parallel frame scheduling around the
replacement detector.

## Replacement implementation and focused evidence

- `camera_worker.process_camera` now calls `boxing.scan_phone_detection_camera`; it no longer calls the old generic `tracking.scan_camera` path.
- The new scanner shares phone-detection's palette-component finder, exclusive component ownership, ordered flash sequence, qualified-session handoff and recovery helpers. It exposes only confirmed `flash-*` sessions to packet decoding. The bounded frame worker still performs independent palette component analysis; tracking and session state remain PTS ordered.
- Focused Ruff passed. `test_boxing.py` passed 12 tests, including a new equivalence check: the scan and `box-video` report the same confirmed-session count on a red/blue capture.
- The first normal red/blue production test decoded all expected IDs and positions. Its old final assertion expected a generic candidate to be rejected for a red/blue preamble. That is intentionally absent now because generic bright/dim candidates no longer enter the replacement detector; the assertion now requires no ignored generic candidate.
- The red/blue production round-trip passed at 24, 30 and 60 fps. A current `otc-v2` clean capture also passed. An older synthetic amber fixture still localized its expected phones under the palette-only scanner; it exposed the same obsolete generic-candidate assertion, which now likewise requires no ignored generic candidate. The user does not require legacy palette tuning; this is retained regression coverage, not a fallback to the old generic detector.

## Final implementation direction

At the user's direction, removed the now-unused generic `detect_screens` and
`scan_camera` production implementation and its old-only test file. The only
production camera scan entry point is `scan_phone_detection_camera`, which is
built from the current phone-detection branch's red/blue palette-only logic.
The next activity is a manual integrated-app check, not further regression
test expansion.
