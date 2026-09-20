# OTC worker - Team 3

An offline worker decodes actual video files into protocol-v1 observations and audience locations. Synthetic MP4s provide independent identity/geometry regressions; original camera recordings provide separate physical evidence. Venue-scale camera validation remains outstanding.

Decoder **v1.5** requires the complete amber/blue preamble before exposing a candidate as a device track. Saturated-blue cores separate screens from irregular reflected hand glow; solid broader and dim footprints remain available. Median motion and a strong footprint-match margin prevent isolated centroid distortions and smaller reflections from breaking a continuous track. The new original clip recovers all three completed devices, IDs 15/16/17, with zero corrections or erasures. See the [tracking investigation](../../.devcontext/teams/otc-localization/journal/20260919-preamble-tracking.md).

Physical follow-up (decoder v1.4): bright emissive cores preserve washed-out amber and separate blue screens from dim clothing. A small morphological opening removes thin glow bridges; a dim-screen path preserves lower-brightness phones. Faint compressed cores can recover a bounded surrounding footprint, while strong cores stay isolated. Association requires compatible position, footprint, area and brightness; pilot fitting and identity acceptance are unchanged. See the [two-screen investigation](../../.devcontext/teams/otc-localization/journal/20260919-two-physical-screens.md) for attempts, final verification and limits.

The v1.3 [track-limit fix](../../.devcontext/teams/integration/journal/20260919-camera-worker-failure.md) remains: expired fragments below the unchanged phase-decoder sample minimum are retired rather than accumulated against the 8192 retained-track limit. Active/decodable tracks and ambiguity checks are preserved; diagnostics report discarded fragments.

## Run from the repository root

Install Bun 1.3.14 and Python 3.13, then:

```powershell
bun run setup:python
.\.venv\Scripts\python.exe tools/otc-fixtures/generate.py --output-dir runtime/otc-demo --count 30
bun scripts/python.ts process --manifest runtime/otc-demo/manifest.json --output runtime/otc-demo/result.json --evidence synthetic --job-id demo-job --debug-dir runtime/otc-demo/debug
bun run gate:otc
```

On POSIX use `.venv/bin/python` instead of `.venv\Scripts\python.exe`. If Bun is installed only in the scaffold's local tool directory, invoke `.tools/bun-1.3.14/bun-windows-x64/bun.exe` in place of `bun`. Choose a fresh output path for each processing attempt. `--debug-dir` must be new or empty.

Setup installs the editable worker and pinned dependencies from `requirements-dev.lock`: PyAV 18.1.0, NumPy 2.4.6, OpenCV headless 4.13.0.92, and the existing validation/test tools. Tested Windows wheels include FFmpeg libraries and the H.264 encoder used by the fixture generator. No separate FFmpeg executable is required on this tested installation; codecs on other platforms require verification. Schemas/codebook are read from `packages/contracts/generated`; preserve the repository layout. The Python pins need captain review before merging.

## Backend boundary

```text
python -m otc process --manifest PATH --output NEW_PATH --evidence synthetic|physical [--job-id ID] [--debug-dir NEW_OR_EMPTY_DIR] [--workers 1|3]
```

- Read the frozen `CalibrationManifest` schema. Video paths may be absolute or relative to the manifest's directory. All declared files must exist and pass SHA-256 verification before any decoding begins. To process fewer cameras, submit a manifest containing only available cameras.
- `--evidence` is required provenance supplied by the caller. Generated footage is always `synthetic`, even though the real video pipeline processes it. `physical` describes original camera footage, not a claim that the result is correct.
- Stdout contains `JobProgress` NDJSON with validate/decode/track/register/complete events. `jobId` defaults to `runId`; the backend should pass its own job ID. Numeric progress is nondecreasing; frame updates can repeat a fraction, and decode/track stages can interleave across cameras.
- Exit 0 and the final complete event follow schema/semantic validation and atomic result writing. Existing result paths are refused. Exit 2 reports JSON diagnostics on stderr for expected input/processing failures. A crash/nonzero exit is also failure, even if some progress/debug artifacts exist. No failed progress event or success result is fabricated.
- The backend owns timeouts, cancellation, unique job directories, upload paths, and authoritative map publication. It must recheck current session/epoch/run/input hashes and reject synthetic results for a physical audience map. The worker produces a candidate map only.
- Default `--workers 3` launches one spawned process for each supplied camera (at most three), with one OpenCV thread and two video decoder threads per camera. Frame tracking stays sequential within each view. The parent validates hashes first, emits progress, merges results in manifest order and writes the final map. Only compact observations/metadata cross processes; each child writes its own debug files.
- `--workers 1` retains a serial reference for benchmarks and diagnosis. Direct Python callers using the default spawn mode must call from a script protected by `if __name__ == "__main__":`; use the CLI in the backend. Camera failures or parent callback exceptions terminate/reap the other children. Forced backend cancellation must terminate the entire process tree, not just its parent.
- `validate-manifest` checks JSON semantics, not video files. Existing `replay-fixture` remains explicitly synthetic JSON replay; it does not invoke the decoder.

Example progress shape (identifiers vary):

```json
{"protocolVersion":1,"jobId":"demo-job","runId":"fixture-run","stage":"register","progress":0.85,"message":"Applying anchors, validating overlap and checking duplicate identities"}
```

## Implemented pipeline and acceptance policy

1. Stream decoded RGB frames using actual presentation timestamps relative to the first decoded frame. Missing/non-increasing PTS fails; corrupt frames are missing evidence. Apply the manifest's clockwise rotation exactly once. Reject clips longer than 60 seconds or frames larger than 16 megapixels.
2. Detect saturated-blue cores, broader bright and dim candidates at native resolution, excluding declared ROIs. Solid broader components can restore a washed-out footprint; irregular blue halos cannot replace a core. Predict motion with recent median velocity. Do not sample uncertain merged detections. Size changes and brief fragments are review warnings when a valid code is decoded; independent persistent screens or verified competing preambles colliding during the packet remain ambiguous. Gaps longer than 350 ms start a new track. No missing colors are interpolated.
3. Learn exposure-relative amber then blue and verify the complete preamble before publishing a device observation. Try the track start and measured amber onsets so an earlier status bar does not hide the boot sequence. Fit phase from the header only, never tag/identity data. Use the interior 25–75% of each 200 ms symbol, at least two samples and 80% color agreement. Missing evidence is an erasure; competing camera phases are rejected. Non-preamble candidates are counted in diagnostics instead of drawn as phones. Geometry uses packet-interval samples.
4. Require the exact run tag and participant membership. Decode each 16-bit extended-Hamming word under `2 * errors + erasures < 4`. A valid bounded pass with an unreadable repeat is accepted with a warning under the user's broader acceptance policy; conflicting readable passes remain ambiguous. Device ID 0 is valid. These bounds do not guarantee detection of arbitrary three-or-more-bit errors; physical false-acceptance audits remain necessary. `decodeScore` is a ranking score, not a probability. See [acceptance decision](../../.devcontext/decisions/20260919-valid-code-acceptance.md).
5. Map ordered anchors (front-left/front-right/back-right/back-left) in rotated image pixels into the primary column's canonical strip. If anchors are null and `frameLayout` declares `from-stage` or `from-back`, derive the corresponding full-frame transform from decoded rotated dimensions and publish `mappingMode: frame-layout`. New uploads default to stage-facing; old manifests without either declaration retain column-only behavior. Manual corners take precedence. Frame layouts cannot seed overlap registration. These are approximate image-based positions, not measured seat depth.
6. Overlap registration requires at least eight shared accepted IDs, distributed matches, RANSAC inliers and a deterministic held-out residual check. Use only the validated support hull; never extrapolate across an unseen crowd. Manual primary-column anchors take precedence inside their ROI; overlap extends coverage outside it or maps an unanchored view. Conflicting positions/columns and duplicate optical IDs (possible reflections) stay ambiguous. Agreeing views choose a primary-ROI position before decode score; `mappingMode` describes the chosen position. Without geometry, consistent primary-camera evidence can yield `coarse` column-only results. Coarse/ambiguous/unseen results have null x/y.

Current optical assumptions: stationary cameras, the full approximately 11-second packet visible with leading/trailing margins, dark neutral guards, and two sufficiently saturated/bright distinguishable colors. Screens are detected and sampled in individual native-resolution ROIs, so their sizes need not match. Perspective fixtures exercise larger front screens, smaller rear screens and converging rows; the 640x360 test includes ordinary rear screens six pixels wide. A separate 1x2-pixel rear-screen case stays unseen. This is fixture evidence, not a universal minimum resolvable phone size.

Static saturated lights are rejected by temporal evidence; use exclusion ROIs when they overlap phones. The initial palette/thresholds need phone-camera experiments. Missing first pilots, severe motion, prolonged occlusion, very tiny/dim screens, auto exposure, rolling shutter, HEVC/HDR and venue lighting remain limitations; synthetic success does not establish physical recall. The auditorium reference photo is not calibrated geometry, and the fixture does not model the balcony or recover a 3D seating map.

## Admin review artifacts

With `--debug-dir`, `index.json` connects camera IDs to safe artifact filenames and includes final observations/locations plus each mapping matrix, support polygon and held-out residual. Each `camera-N.png` labels tracks on one preview (green accepted, orange other); `camera-N.json` contains phase, sampled symbols, interior counts, normalized pilots, trajectory, final status and reasons. Preview positions are nearest track samples and can be stale for a track absent at that instant; use `previewPtsMs` and trajectories for review.

These artifacts are worker-owned diagnostics, not a new frozen public API. Team 4 should use the frozen result for map rendering and display `mappingMode`, status and evidence. The backend must explicitly serve/restrict artifacts if the dashboard needs access. Keep raw footage and debug files in ignored runtime storage.

## Verification and next work

Current decoder is **otc-v1.6**, with **116 Python tests** and a fresh original-file decode accepting all **5/5** phones with approximate coordinates. The earlier two-phone sample still accepts exactly **9/11**. Read [current integration evidence](../../.devcontext/teams/integration/journal/20260919-five-phone-positioning.md). The v1.2–v1.5 records below are historical.

See [Team 3 handoff](../../.devcontext/teams/otc-localization/handoff.md), [parallel/perspective evidence](../../.devcontext/evidence/otc-localization/20260919-parallel-perspective.md), [initial evidence](../../.devcontext/evidence/otc-localization/20260919-pipeline.md), and [fixture tools](../../tools/otc-fixtures/README.md). Run `bun run gate:otc`; generator/benchmark lint additionally uses `.venv\Scripts\python.exe -m ruff check workers/otc tools/otc-fixtures`. Focused tests live under `workers/otc/tests/` and generate their own MP4s.

Current decoder `otc-v1.5` passes **103 Python tests** and the shared gate. Fresh production CLI reads recover all three completed phones (15/16/17) in the new physical sample and both phones (9/11) in the earlier sample, with zero corrected/erased bits. Results remain column-only without seating anchors. See [current evidence and failed experiments](../../.devcontext/teams/otc-localization/journal/20260919-preamble-tracking.md). The v1.2 [integration audit](../../.devcontext/evidence/otc-localization/20260919-integration-audit.md) is historical. Run `bun tools/otc-fixtures/verify-handoff.ts` for generated clips through the actual worker and consumer TypeScript schemas; this remains synthetic boundary evidence. Shared wire schemas and packet version are unchanged.

On the recorded Ryzen 7 7840HS run, unchanged 1,500-ID 4K inputs took 97.80 seconds serial and 32.19 seconds with three camera workers; outputs are identical except processingMs. Sampled aggregate resident memory rose from 292.90 to 801.14 MiB. This is one synthetic comparison, not a hardware-independent or physical-venue guarantee.

The v1.2 audit rerun on those same inputs localized all 1,500 in 30.83 seconds, with an 805.49 MiB sampled aggregate resident peak. The curved auditorium fixture also decoded every ID, but its null anchors intentionally produce only coarse/ambiguous locations; see the audit for counts and limits.

The v1.4 rerun of the same clean 1,500-phone three-camera inputs localizes all 1,500 correctly in 54.42 seconds with ~810 MiB sampled aggregate resident memory. Two candidate masks cost more processing time than v1.2, but remain under the 90-second target on this machine. These scale results are synthetic; the original two-phone sample takes 81.88 seconds for its longer, cluttered 43.5-second recording.

The v1.5 rerun retains **1,500/1,500 correct locations** in 88.85 seconds processing / 89.48 seconds wall, with ~816 MiB sampled aggregate resident memory. Three masks and robust association cost more; the synthetic 90-second target has little margin on this run. See the current investigation for exact commands, hashes and physical-clip results. Benchmarks disable debug artifacts and do not establish physical venue throughput.

Next physical proof: record independently labeled device IDs near and far with original camera files, audit visible-phone recall and false acceptance, then check three-camera geometry, runtime and memory. The two-screen sample establishes a narrow physical result; it does not verify venue-scale recall, seat geometry or complete concert acceptance.

API references: [PyAV containers](https://pyav.org/docs/stable/api/container.html), [OpenCV shapes/contours](https://docs.opencv.org/4.x/d3/dc0/group__imgproc__shape.html), [OpenCV homography](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html). Installed-library behavior is exercised by the tests.
