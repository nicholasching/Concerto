# Preamble eligibility and track continuity — 2026-09-19

User requests stricter phone detection based on the initial orange/blue sequence and better track retention through a recording. Another agent owns clock/connection stability; this work is limited to OTC, its focused fixtures/tests, and Team 3 documentation. Preserve outstanding client/tunnel changes and live calibration state.

Baseline is main `a052e68`, integrated decoder otc-v1.4 (90 Python tests; older physical clip recovers IDs 9 and 11). New original clip: `WIN_20260919_17_00_11_Pro.mp4`, supplied outside Git. Do not use a presumed count, manually chosen screen positions, or expected IDs as detection inputs. Captured membership/run metadata may constrain final protocol validation, never fit optical identity.

Plan: inspect original frames and saved capture metadata; establish baseline trajectories/acceptance; identify where clutter becomes a track and where real screens fragment; add bounded pilot/preamble eligibility and conservative continuity improvements with independent negative/occlusion/crossing tests; rerun both original clips, focused OTC gate, and scale check if the tracking path changes. Never interpolate missing symbols or relax packet/tag/membership/error bounds. Raw frames/clips and intermediate artifacts remain ignored under runtime.

Success criteria: fewer non-preamble objects exposed as device tracks, improved complete real-screen trajectories supported by measured pixels, no accepted identity swaps, retained rejection of static lights/reflections/crossings/incomplete packets, and no regression on the original two-screen clip. Physical clip conclusions and synthetic coverage are reported separately.

## Evidence and failed experiments

User independently confirms three completed devices, IDs unknown. Original SHA-256: `b9cda28fa3af4f2c92f81da62f768eba36d2f4411b11dfda16aea5ad491d93ca`; 1920x1080, 17.4295 seconds, 523 frames. The matching saved job manifest `6ab4a14c-515a-4d38-9b0c-dafebe45c9e0` has run tag 13 and eligible participants [15,16,17]. Four screens begin flashing; the foreground-left screen visibly stops early. No human identity is inferred.

Baseline v1.4 accepts 15/16, misses 17, and exposes 664 rejected candidates as question marks. These were not falsely accepted IDs, but the overlay incorrectly suggested hundreds of device tracks. Local candidate caches/frames remain under ignored `runtime/otc-tracking-investigation/`; screen coordinates used for inspection never entered production.

- Global amber/blue hue restrictions still recovered only two phones. A globally stricter blue mask exposed one pass of 17 but shortened other tracks. Both failed approaches were discarded.
- The first cropped-core experiment reused a full-frame area limit on a small ROI and refined nothing. Correcting that experiment recovered 17's header but not its full packet. That helper was removed; final masks operate at full-frame coordinates.
- Reflected blue light on a hand can expand 17's component from about 110x182 to 200x326. Saturated blue cores plus restoration of solid broader footprints resolve the halo while preserving washed-out/dim screens.
- At 13,856.97 ms, one distorted centroid jumped from roughly (1152,791) to (1140,761). Single-frame velocity extrapolated farther upward, although the next real screen was at (1151,790). An independently failing regression proves the loss; median velocity over recent samples fixes it without increasing the 350 ms gap or 40 px radius limits.
- Smaller overlapping reflections poisoned associations. A two-frame failing regression covers both initial competition and the leftover fragment. Only a dominant footprint (IoU >=0.65, margin >=0.25, expansion <=25%) resolves a distractor; near ties/merges remain ambiguous.

## Implemented v1.5 and checks

Complete measured amber-then-blue pilot/preamble evidence now gates published observations, overlays and detailed tracks. Other candidates remain counted in diagnostics. Phase fitting also considers measured amber onsets when a status bar predates the boot sequence; only the header determines phase. Geometry/trajectories use the packet interval. Run tag, membership, agreeing bounded passes, error/erasure limits and geometry rules remain intact. No invented samples or stitching across long occlusion.

Focused sampling/tracking/pipeline checks: **39 passed**. Includes an independent rendered MP4 with blue hand glow, motion and transient exposure bands, plus existing cover, crossing, reflection, wrong-tag, empty, rotation and variable-PTS checks. Static/alternating clutter, reversed/non-palette pilots and long pre-recording lead-ins have explicit tests.

Fresh production reread: **15/16/17 accepted, zero corrections/erasures**, each tracked from approximately 4.86/4.93 to 15.06/15.09 seconds. Exactly three published device observations; 1,230 non-preamble candidates summarized. Result: `runtime/otc-tracking-investigation/physical-three-v15.result.json`. Time 46.80 s while focused tests ran concurrently, not an isolated throughput benchmark. Ruff and whitespace checks pass. Full gate, older original clip and scale check follow.

Only OTC, its fixture/tests and Team 3 documents are edited here. The other agent's clock/client/shared-context work is preserved. The user moved on to live run 15 while these offline checks ran; no active run/map was replaced or committed. Venue/three-camera/acoustic acceptance remains separate.

## Independent older-clip regression

The first full gate passed 101 tests, but the original two-phone recording caught a regression: only 9 accepted, while 11 fragmented at 33,826 ms. This attempt is preserved as `physical-two-v15.result.json`; it is not a successful result. Replaying the old candidate masks with the new association recovered both, isolating the fault to segmentation. Measured frames show a pale horizontal exposure band splitting 11's saturated blue core into two islands, although its broad bright footprint stays solid (56x89, fill about 0.86).

The detector now restores a solid broad bright footprint containing multiple saturated islands as well as a single core. The contained islands cannot compete with that footprint. Irregular hand-glow contours still retain their compact cores. A new eight-frame exposure-band regression fails before this fix and passes after it; a separate adjacent-screen bridge test ensures a real merge remains ambiguous. Focused tracking/sampling: 26 passed. Fresh reads of both original recordings and the full gate follow; earlier success on the new clip alone was insufficient.

## Final physical verification

Fresh production CLI rereads after the exposure-band fix:

- `physical-three-v15-final.result.json`: exactly **three accepted IDs 15/16/17**, zero corrected/erased bits, both bounded passes agree. Tracks contain 304/307/307 measured points through the full colored packet interval (about 4.86–15.09 seconds); maximum adjacent gaps are 64.17/47.97/47.97 ms. 1,230 non-preamble candidates are summarized rather than displayed as devices. Processing 40.47 seconds.
- `physical-two-v15-final.result.json`: exactly **two accepted IDs 9/11**, zero corrected/erased bits, 299/306 measured points (about 29.95–40.13 seconds). Maximum gaps 79.90/47.93 ms. 2,162 non-preamble candidates summarized. Processing 88.26 seconds. Both replays overlapped in wall time, so these are recorded job durations, not isolated performance comparisons.
- All five final sampled packets reject a wrong run tag and reject membership with their decoded ID removed. Compact details: `runtime/otc-tracking-investigation/final-physical-checks.json`. No expected count, IDs or screen coordinates were added to production.
- The final three-device preview was visually inspected: labels sit on the three flashing phones; the stopped foreground phone and background objects are unlabelled. Artifacts stay under ignored `runtime/otc-tracking-investigation/physical-{two,three}-v15-final.debug/`.

IDs are optically decoded, not independently human-labeled. The user's independent count is three for the new clip and two for the earlier clip. These are single-camera checks without seating anchors, producing column-only locations; they do not establish venue recall, exact seats or multi-camera calibration. No active backend run or authoritative map was replaced. New processing attempts load the editable v1.5 worker without restarting the backend.

## Final automated checks

`bun run gate:otc` from the repository root passes: **103 Python tests in 120.24 seconds**, 14 contract tests, generated schema/fixture checks, source boundaries, TypeScript and ESLint. Separate `.venv/Scripts/python.exe -m ruff check workers/otc tools/otc-fixtures` and focused `git diff --check` pass. The final rendered MP4 regression includes both reflected glow and a pale exposure stripe inside a blue preamble. Existing wrong-run, membership, duplicate/reflection, crossing, long-occlusion, undersized-screen, PTS/rotation, geometry and CLI checks remain intact. No packet, shared schema, backend, browser or dependency changes are part of this work.

Fresh existing three-camera 4K benchmark after the other OTC checks finished:

```powershell
.venv/Scripts/python.exe tools/otc-fixtures/benchmark.py --manifest runtime/otc-fixtures/density-1500/manifest.json --truth runtime/otc-fixtures/density-1500/ground-truth.json --output-dir runtime/otc-fixtures/density-1500/parallel-v15 --workers 3
```

**1,500/1,500 localized**, no wrong localized IDs, maximum canonical error 0.000531 (tolerance 0.015); 88.85 seconds processing / 89.48 seconds wall; sampled process-tree peak 855,957,504 bytes (~816 MiB), four processes, zero incomplete memory samples. The extra mask and robust association increase cost versus the prior v1.4 54.42-second run. The initial 90-second synthetic target has little margin on this run; this is not a physical venue or cross-machine guarantee. Debug artifacts are disabled for this benchmark, as in the earlier comparison. Full metrics and hashes: `runtime/otc-fixtures/density-1500/parallel-v15/metrics.json`.

Handoff: code/tests/docs are local working-tree edits on main `a052e68`, not committed or pushed in this task. Use a fresh processing attempt to obtain v1.5; existing results remain unchanged. Offline reproduction uses `python -m otc process --manifest <saved manifest> --output <fresh result> --evidence physical --debug-dir <fresh debug directory>`. The saved new/old manifests are respectively `runtime/local/jobs/6ab4a14c-515a-4d38-9b0c-dafebe45c9e0.manifest.json` and `runtime/local/jobs/966bee6c-40e4-4bdd-86c4-f57f94b1afb8.manifest.json`; retain their original hashes, tag and captured membership, updating only machine-local video paths if transferring the original clips. Raw footage/caches stay outside Git. Next optical acceptance is independently labeled near/far and three-camera footage; the separate agent continues clock/connection work.

API references: [OpenCV HSV ranges](https://docs.opencv.org/4.13.0/da/d97/tutorial_threshold_inRange.html), [morphological opening](https://docs.opencv.org/4.13.0/d9/d61/tutorial_py_morphological_ops.html). Incident conclusions and thresholds come from the local evidence above.
