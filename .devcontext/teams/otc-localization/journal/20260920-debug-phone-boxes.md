# Debug-phone clip boxing client

Date / agent: 2026-09-20 / Codex (user-directed narrow Team 3 integration)

## Goal, baseline and ownership

- Goal: add a local upload-and-review client that returns an annotated video
  showing boxes from the existing OTC screen detector/tracker.
- Baseline: `phone-detection` at `7cbe031`; the preceding debug-phone QR tool
  is uncommitted local work. The inspected source implementation is
  `workers/otc/src/otc/tracking.py` at decoder v1.7.
- User explicitly requested this narrow cross-ownership extraction. Planned
  files are `debug_phone/detection_boxing/`, `debug_phone/server.ts`, and an
  additive diagnostic CLI/module under `workers/otc/`. No contract, mapping,
  identity-acceptance, production app, lockfile, or detector-default change is
  authorized.

## Assumptions and success criteria

- The requested first milestone is visual phone/screen boxing, not final device
  ID acceptance. A visible box therefore means the existing detector/tracker
  formed a retained screen track; it must not be presented as a decoded,
  authenticated or mapped device.
- The browser is local-only. The debug phone's public QR tunnel must not serve
  raw video uploads or artifacts.
- A successful slice uploads one supported clip, applies `scan_camera()` with
  its unchanged production defaults, creates an annotated MP4 with a current
  track box/label on detected frames, and lets the local page play/download it.

## Plan and checks

1. Add an additive `box-video` worker command that runs the existing
   `scan_camera()` and renders its recorded track samples in a second video
   pass. Verify it using a generated synthetic clip and inspect output frames.
2. Add a same-folder local web client plus bounded job API. Verify upload,
   status and result endpoints against that CLI; reject forwarded/tunnel
   requests.
3. Run focused Python tests, the worker lint, the debug-phone packet test and
   the Team 3 gate. Physical phone/camera recording remains separate evidence.

## Deferred

Optuna and parameter sweeps are deliberately not included in this slice. When
added later, they must optimize a bounded set of material detector values (for
example red/blue sensitivity, exposure/brightness and minimum cluster size)
against labeled clips without weakening the production decoder's identity
acceptance policy.

## Confirmed red/blue diagnostic scope

The user approved a faithful port of the `fix-detection` diagnostic
qualification into the boxing output. The port will keep the branch semantics:
two samples of each palette colour, 350 ms visibility lifetime, and one
unambiguous overlapping-fragment handoff. It will use the current worker's
stronger candidate-component and association code rather than replacing
`tracking.py` with the branch's older divergent implementation. In the boxed
video, generic tracks are cyan markers; only red/blue-qualified tracks get the
green `red + blue` rectangle. This remains non-identity diagnostic evidence.

## Live tuning change

At the user's request, the diagnostic red HSV hue tolerance changed from
±20 to **±5**. This narrows red matching; palette saturation/brightness,
blue tolerance, blob filtering, tracking and production decoder settings are
unchanged. The local boxing server spawns the worker from source for each job,
so this applies to the next uploaded clip without a server restart.

## Current checkpoint before stable-footprint follow-up

- Implemented: `python -m otc box-video` and the local
  `/detection-boxing` upload page. The renderer uses the current worker's
  component filtering and association, the ported red/blue qualification and
  fragment handoff, and produces cyan current-track dots, magenta neutral-flash
  seeds and green `red + blue` rectangles.
- Focused verification before the final red-tolerance adjustment:
  `pytest workers/otc/tests/test_boxing.py -q` passed (2 tests); Ruff passed
  for the boxing and qualification modules. A local HTTP upload of a generated
  405-frame red/blue clip completed and returned 2 qualified tracks / 264 green
  boxes. Tunnel-forwarded boxing requests received 403.
- The full `bun run gate:otc` was user-interrupted while the long existing video
  suite was running. It had already passed contracts, fixtures, boundaries,
  TypeScript typecheck, JS lint, contract tests and worker Ruff; it did not
  complete, so no full-gate pass is claimed.
- The just-requested ±5 red-hue adjustment is intentionally not rerun here:
  the user asked to run the app rather than continue checks. It must be
  re-exercised on the next uploaded red/blue clip.

## Next action

Commit this isolated diagnostic baseline, then change the boxing path to use a
stable full-screen tracker for box geometry and red/blue only for qualification.
That follow-up should eliminate the demonstrated stacked-fragment boxes without
changing the production detector or identity policy.
