# Debug-phone verbose evidence mode

Date / author: 2026-09-20 / Codex (Team 3 scope)
Status: in progress
Baseline: `73074f1` on `phone-detection`

## Goal

Add an opt-in local diagnostic mode for `/detection-boxing`. It must retain the
last red and blue components that qualify each green flash-sequence session in
the annotated video, and create synchronized red-only and blue-only mask
videos labelled with the active HSV limits.

## Assumptions and plan

- Normal boxing remains a single clean annotated MP4.
- Verbose evidence is diagnostic only; it changes neither palette thresholds
  nor qualification/tracking decisions.
- The local debug server may pass a new worker CLI option because this is an
  explicitly requested narrow integration with the Team 3 worker.

Planned verification: focused boxing tests and Ruff, then one local verbose
upload whose three video endpoints return MP4 data.

## Implementation and checks

- `PaletteEvidence` now retains the exclusive screen component for each
  colour. A confirmed logical session remembers its latest red and blue
  components, so verbose rendering shows both rectangles while its green box
  is visible. This is presentation-only and does not alter qualification.
- `box-video --verbose-output-dir` atomically writes `red-mask.mp4` and
  `blue-mask.mp4` alongside the usual annotated MP4. Each is synchronized to
  the source and labels its hue, hue tolerance, saturation floor and value
  floor. No verbose directory means only the prior annotated MP4 is emitted.
- The local server adds a checkbox, forwards the flag, exposes the two
  artifacts only for verbose jobs, and the page presents both outputs.

Verification on the implementation working tree:

- `python -m pytest workers/otc/tests/test_boxing.py -q` — 9 passed. The
  focused integration test asserts both generated mask videos have the same
  frame count as the source result.
- `python -m ruff check workers/otc/src/otc/boxing.py workers/otc/src/otc/__main__.py workers/otc/tests/test_boxing.py` — passed.
- `bun test debug_phone/packet.test.ts` — 3 passed.
- Local verbose API job `e3960ca9-8e81-4f08-bc01-9f9384d332b2` using the
  synthetic 640x360 red/blue clip completed with 405 frames; `/video`,
  `/red-mask` and `/blue-mask` each returned HTTP 200 and nonempty MP4s.
- Local default API job `40222733-e1fa-409e-9988-dde60b8f3126` completed with
  `verbose: false`; `/video` returned 200 and `/red-mask` returned 404.

Limitation: this verifies generated masks, worker output and local endpoint
delivery. A human should still inspect verbose output on representative
camera footage when choosing palette thresholds.

## Follow-up diagnosis: visible but unqualified centre phone

The latest representative local verbose job showed palette rectangles for all
four phones, while the third from the left did not receive a green box. This
is not an HSV miss: the centre footprint (approximately x=965) had a
red/blue-mask component. Its raw screen observations were instead fragmented
across early, middle and late track IDs. In the central fragment, a short
unobserved interval during the second red phase reset `FlashSequence`; the
following blue phase therefore had no valid red-blue-red history to complete.
The current rule requires consecutive evidence from one raw screen track with
gaps no greater than 100 ms. No detector behavior was changed from this
diagnosis alone.

## Follow-up implementation: same-track phase grace

Approved change: increase only the per-phase gap allowance from 100 ms to 200
ms. This is below the 350 ms raw-track expiry and does not transfer pending
qualification between tracks. A focused sequence test covers a 170 ms gap;
the existing 300 ms gap rejection remains the upper-bound regression check.
Focused automated verification was intentionally deferred at the user's
request; the next action is a front-end rerun of the representative clip.

## Follow-up implementation: green-box display hold

Approved change: hold the last confirmed green rectangle for 750 ms after its
raw screen sample disappears. The 350 ms selected-fragment handoff window is
unchanged, so this is visual persistence only and cannot widen identity
transfer behavior.
