# OTC intermittent recall investigation

Baseline: main `bcfa0d9378e13f34ad5a0e1fe417bf56da8a3d8a`; clean checkout at start.

User reports about 40% missing in a recent live test using current repository state. All phones visibly complete flashing and remain visible; different devices fail on successive attempts. Exact capture/job is not yet identified.

Scope: read-only tracing across calibration preparation, browser renderer, video tracking, sampling/identity acceptance, and mapping. Record evidence here; no production implementation, shared contract, live run or map changes planned. Preserve reference tree.

Success criterion: explain implemented flow, identify concrete rejection mechanisms and distinguish reproduced failure modes from causes demonstrated in the user's current recording.

Plan/checks: inspect current source and saved local physical job diagnostics; run focused OTC gate and isolated sampling experiments in ignored runtime storage. Compare exact header/tag requirements, sampling density, per-camera phase clustering, and track continuity. Physical recall remains unverified without identifying the recent recording.

Initial findings: 55 symbols at 200 ms; exact 11-symbol header and 8-bit run tag; middle 100 ms of each symbol with >=2 samples and >=80% consistent votes. Individual phases are fitted but accepted only within 75 ms of camera consensus. Current internet clock readiness permits up to 150 ms estimated uncertainty. Candidates lacking a full header are omitted from per-track debug output, limiting diagnosis.

## Confirmed physical recording

User confirms run tag 22 is one of the failing tests. Saved manifest/result: `runtime/local/jobs/c418be5c-32f0-4250-8996-ea129190fef5.{manifest,result}.json`. Four participants [0,1,2,3], red-blue-v1, 1920x1080, 424 frames. Original SHA-256: `3ab50055ef8b9e04eb487163e09b288309293ad3caff08203b358b710fcae41b`.

Fresh scan with unchanged detector reproduces the saved observations: IDs 1/2 accepted with both passes and no corrected/erased bits. Middle screen track `screen-6258` has only one interior sample in run-tag slot 13, then ends at 8563.54 ms, versus successful tracks ending at 12896.9 ms. Upper screen `screen-6551` has 278 samples but no verified header; sampling at the camera phase leaves header slots 2/4/9/11 unreadable. These are tracking/sampling losses before mapping. Headerless candidates are not individually retained in normal debug output.

Saved physical jobs at tags 20/21 also contain uncertain-run-tag rejection; tag 21 additionally has a cross-camera mapping ambiguity. Counts use frozen participant sets, not independently audited visible-phone denominators.

## Segmentation evidence and offline experiment

`tracking.detect_screens` isolates saturated blue cores but processes red using broad bright/dim masks. In the original RGB frame at 8730.2 ms, the middle red screen belongs to a bright connected component spanning 142x188 px, including surrounding skin/clothing. Its fill ratio is 0.32967, below the detector's 0.35 limit, so the screen disappears as a candidate although visually unobstructed. A diagnostic red-core mask isolates 65x96 px with fill 0.77228. Earlier header/tag frames also show expanded red footprints and competing nearby components.

Ignored `runtime/otc-recall-investigation/red_core_probe.py` applies existing core handling to two saturated-red hue ranges in memory only. Reprocessing the same original recording restores ID 0, yielding accepted IDs 0/1/2, both passes agreeing, zero corrections/erasures. The fourth screen now gets a complete header but still rejects for uncertain run tag. No production decoder edits, guessed IDs, relaxed identity checks, or map commits. This is a promising partial counterfactual, not a verified production fix. Diagnostic ROIs in `probe.py` are inspection-only and never detector inputs.

The repeated red-core experiment confirms the same result and preserves detailed samples. Fourth-screen phase is 2363.84 ms, within 50.04 ms of camera consensus (therefore the 75 ms camera gate is NOT its failure). Slot 20, the last run-tag bit, has three measurements: red at 6430.02 and 6463.50 ms, blue at 6496.84 ms. Two of three votes fail the 80% requirement. Both identity passes have no erased bits, but tag rejection happens first. A diagnostic phase shift of -20/-40 ms resolves the tag while breaking header agreement; +20/+40 ms also breaks the header. A single arbitrary global phase shift is not a demonstrated fix. Investigate transition timing/within-packet drift and sampling around boundaries; do not infer a specific browser/network/camera mechanism from these samples alone.

## Independent sampling experiments

Five complete synthetic tracks with relative starts [0,0,0,100,100] ms produce three accepted and two phase-rejected observations. Offsets [0,0,0,200,200] make the entire camera phase ambiguous. These use one fixture identity to isolate pre-geometry phase behavior; they do not prove a current physical clock fault or five unique localized devices.

Erasing a single header bit rejects a perfect packet; erasing one tag bit also rejects; erasing one identity bit is recovered. Thus ID error correction cannot compensate for missed header/tag evidence. At 30 fps the middle-100-ms window usually has only three samples; one inconsistent sample gives 2/3 votes, below 80%. The live clock estimator also updates during a flash; constant-phase decoding assumes no material intra-packet timing change. These are follow-up risks, not established causes of all reported misses.

## Checks and handoff

- Initial `bun run gate:otc` failed because Bun was absent from PATH; rerun using documented `.tools/bun-1.3.14/bun-windows-x64/bun.exe run gate:otc` passes shared generation/boundaries/types/lint, 14 contract tests, Ruff, and 142 Python tests (157.01 s). This validates unchanged production baseline, not the experimental mask.
- Focused sampling/protocol: 31 passed in 2.10 s.
- Raw footage, scan caches, frame extracts and experiment reports remain ignored under `runtime/otc-recall-investigation/`. No reference-tree or production changes.
- Next owner action: implement/test symmetric red-core isolation in OTC with clean/dim/washed/adjacent-screen/reflection/collision and legacy-amber coverage; diagnose the fourth phone's tag loss using per-slot evidence. Preserve tag/membership/collision protections. Improve early-rejection diagnostics. Check phase policy against actual optical start spreads before changing timing thresholds. No new physical capture or venue recall claim in this session.
