# Detection tuning investigation

Date / agent: 2026-09-19 / fix-detection

## Goal

Create the `fix-detection` branch from integrated `main` and identify the real-camera detection and association hyperparameters that can be tuned without weakening frozen packet identity acceptance.

## Baseline

- Branch / commit: `fix-detection` / `a052e68`; `foundation-v1` is `ab59c27105627977ee52dc2bcd4276b4532b9e2a`.
- Working tree was clean before branch creation.
- Current decoder is `otc-v1.4`. The retained physical one-camera sample previously accepted exactly IDs 9 and 11, with zero corrected/erased bits; this is narrow physical evidence, not venue validation.

## Inspection and decision boundary

- Tunable candidate detection and association literals are in `workers/otc/src/otc/tracking.py`; sampling confidence literals are in `workers/otc/src/otc/sampling.py`.
- Packet duration, preamble/tag, extended-Hamming bounded-error rule, agreeing repeated ID passes, participant membership, duplicate rejection, and ambiguous-track rejection are protocol/safety invariants. Do not relax them to improve recall.
- No worker CLI/config surface currently exposes threshold overrides. Any proposed configuration needs an explicit immutable per-run record, physical negative cases, and the focused `bun run gate:otc` check.

## Next action

Implemented a local `python -m otc diagnose-camera --camera 0` candidate monitor. It uses a Tk desktop window (so the pinned headless OpenCV package remains unchanged), live webcam frames, raw bright/dim masks, candidate boxes and sliders for the seven candidate segmentation/component parameters. Slider changes reset diagnostic tracks. The monitor never invokes packet decoding or writes a map/result.

Verification:

- `.\\.venv\\Scripts\\python.exe -m pytest workers/otc/tests/test_tracking.py workers/otc/tests/test_diagnostic.py -q`: 17 passed.
- `.\\.venv\\Scripts\\python.exe -m ruff check workers/otc`: passed.
- `.\\.venv\\Scripts\\python.exe -m otc --help`: includes `diagnose-camera`.
- `bun run gate:otc`: blocked before worker tests by existing root TypeScript module-resolution errors for `qrcode` and `@orchestra/sync`. The branch does not edit those packages or root dependency state.
- First desktop launch exposed a panel-composition shape mismatch (480-pixel main panel stacked above 960-pixel mask pair). Corrected the main-panel preview to 960x540 before relaunch; this is a monitor-only UI fix.
- Diagnostic display now isolates the default amber/yellow (#ffb000) and blue (#0066ff) calibration hue bands, darkens non-palette pixels to 25% exposure, and restores palette pixels at their original brightness. The monitor's candidate overlay uses this palette union. Added independent yellow/blue hue-tolerance sliders. Production processing keeps its characterized all-hue bright/dim candidate path pending physical recording evidence.
- First palette-monitor restart caught a local UI initialization error for hue-slider defaults. The slider source now selects palette versus detection settings by field; no worker processing behavior changed.
- User reported sliders appeared non-functional. Inspection found the palette display used only the dim-mask saturation/value fields while the UI also exposed unused bright-mask sliders. Replaced those with explicit palette saturation/brightness controls, which directly change the yellow/blue masks and dimmed-image highlight. Relaunch the monitor as a detached interactive desktop process so its event loop is not tied to a terminal command lifetime.
- Added monitor-only flash seeding: a neutral, bright, per-pixel luminance rise produces magenta candidate boxes during the initial white pulses. Those detections enter the same conservative spatial association as later palette detections, which gives amber/blue sampling a preexisting screen track. The flash is a visibility seed only, not an identity result. Sliders expose brightness, maximum saturation, and minimum rise; a test proves blue color and stable bright pixels do not seed a flash.
- The monitor now promotes only tracks with repeated evidence of **both** configured palette colors (at least two amber/yellow plus two blue samples). It draws promoted tracks in green, leaves one-color blobs unselected, and can promote multiple independent tracks. This is monitor visibility gating only; packet/tag/membership/two-pass acceptance remains unchanged for identity.
- Added a separate live Minimum blob width/height slider. It controls the previously fixed minimum component dimension in the detector (default 4 px) independently of Minimum area, so small but elongated/noisy regions can be tuned without changing the area floor.
- Fixed two monitor interaction defects reported by the user: historic blue/yellow evidence no longer keeps a vanished blob selected (both-color evidence must be within the last 1.2 seconds and the track itself fresh within 350 ms), and controls use a separate Tk live-settings window rather than mixing incompatible layout managers. Minimum blob width/height is visible there alongside Minimum area.
- Added root `DETECTOR_TEST_BENCH.md` as the reproducible runbook for the public QR phone test page and local camera monitor, including live controls, exact packet behavior, safety, physical-test procedure, tunnel notes, and focused verification commands.
- Qualification now latches per visual track: repeated blue and yellow observations promote a currently visible track, then it remains selected while later samples continue from either one colour. A missing blob still fails the 350 ms freshness limit and is unselected. The focused regression covers a blue hold after the qualifying pair.
- Overexposed yellow can now count as white in the diagnostic monitor: qualification is repeated **(yellow or high-brightness/low-saturation white) plus blue** on one active track. White has separate live maximum-saturation and brightness sliders, conservatively defaulting to S <= 80 and V >= 210. This admits clipped yellow screens without turning every neutral pixel into a candidate; it does not change production decoder behavior.
- Verification after white support: focused diagnostic/tracking tests passed (20 tests), Ruff passed, `git diff --check` passed, and `bun run gate:otc` passed. The remaining validation is a physical webcam check under actual overexposure.
- Superseded the experimental yellow-or-white diagnostic rule at the user's direction. The test bench and camera monitor now use the same packet timing, blue and neutral behavior as before, with **red (`#FF0000`) replacing yellow (`#FFB000`)**. Qualification is repeated red plus blue only; white is deliberately excluded. Production calibration remains unchanged pending a separate protocol/renderer decision.
- Verification after the red replacement: diagnostic/tracking tests (20) and the detector-page test pass; `bun run gate:client`, `bun run gate:otc`, Ruff, and `git diff --check` pass. The running camera process must be restarted to load this revision.
- Investigated a report that a selected phone lost its green box during a single-colour red/blue hold. The palette latch was already historical, so the likely failure is conservative spatial association splitting a phone when the colour footprint changes. The monitor now transfers qualification only to one current, overlapping fragment (area ratio 0.2..6 and >=10% smaller-footprint overlap); multiple possible targets or separate blobs do not inherit. No visible palette blob still expires after 350 ms. Added positive and negative regression tests; focused suite has 22 tests and the OTC gate passes.
- After restoring the frozen JavaScript installation (no lockfile change), `bun run gate:otc` completed successfully. After the qualification-latch change, `bun run gate:otc` completed again and the focused diagnostic/tracking tests report 20 passing tests; Ruff passes.

Next: use a physical webcam/phone session to characterize false negatives/fragment theft, select one bounded default change if evidence supports it, and add a recording regression. Do not alter shared contracts or the reference tree.
