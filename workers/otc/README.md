# OTC worker - Team 3

An offline worker decodes actual video files into protocol-v1 observations and audience locations. Synthetic MP4s provide independent identity/geometry regressions; original camera recordings provide separate physical evidence. Venue-scale camera validation remains outstanding.

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

### Local detector monitor

For camera/palette troubleshooting on a desktop with a webcam, run:

```powershell
.\.venv\Scripts\python.exe -m otc diagnose-camera --camera 0
```

It isolates default amber/yellow and blue calibration hue bands, darkens the rest of the
live image, and displays a separate mask for each palette color. A neutral bright-rise
detector marks initial white flashes with magenta seed boxes; palette candidates are yellow.
Hue, flash, and candidate segmentation/component sliders are local diagnostics; changing one
resets tracks. A green box appears only after a track has at least two amber/yellow and two
blue observations in the recent 1.2-second window, and disappears within 350 ms when palette
evidence stops; multiple qualifying tracks are shown independently. Controls open in a separate
live-settings window. These boxes are **not** decoded identities.
The monitor never writes a result or map and does not relax packet acceptance. It requires
the standard Windows Python `tkinter` GUI support and webcam access; use the full
`process` command to decode a captured calibration recording.

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
2. Detect bright and dim chromatic screen candidates at native resolution, excluding declared ROIs. Trace contours and measure small interior regions; retain trajectories and one preview, not the uncompressed movie. Spatial/velocity, footprint and peak-brightness gating track modest motion without attaching nearby clothing fragments. Crossings, merged candidates and abrupt size changes mark identities ambiguous. Gaps longer than 350 ms start a new track. Large exposure jumps can split tracks; no missing colors are interpolated.
3. Learn two colors from each track's pilots; fit temporal phase from pilots/preamble only. Use the interior 25–75% of each 200 ms symbol, at least two samples and 80% color agreement. Insufficient evidence is an erasure. Competing camera phases are rejected.
4. Require the exact run tag and participant membership. Decode each 16-bit extended-Hamming word under `2 * errors + erasures < 4`; both independently decoded passes must agree. One-pass evidence is review-only. Device ID 0 is valid. These bounds do not guarantee detection of arbitrary three-or-more-bit errors; correlated errors across both passes remain a physical validation concern. `decodeScore` is a ranking score, not a probability.
5. Map ordered anchors (front-left/front-right/back-right/back-left) in rotated image pixels into the primary column's canonical strip. Audience x runs left to right and y front to back, independently of the image's visual orientation. A column homography is approximate geometry, not metric seat localization.
6. Overlap registration requires at least eight shared accepted IDs, distributed matches, RANSAC inliers and a deterministic held-out residual check. Use only the validated support hull; never extrapolate across an unseen crowd. Manual primary-column anchors take precedence inside their ROI; overlap extends coverage outside it or maps an unanchored view. Conflicting positions/columns and duplicate optical IDs (possible reflections) stay ambiguous. Agreeing views choose a primary-ROI position before decode score; `mappingMode` describes the chosen position. Without geometry, consistent primary-camera evidence can yield `coarse` column-only results. Coarse/ambiguous/unseen results have null x/y.

Current optical assumptions: stationary cameras, the full approximately 11-second packet visible with leading/trailing margins, dark neutral guards, and two sufficiently saturated/bright distinguishable colors. Screens are detected and sampled in individual native-resolution ROIs, so their sizes need not match. Perspective fixtures exercise larger front screens, smaller rear screens and converging rows; the 640x360 test includes ordinary rear screens six pixels wide. A separate 1x2-pixel rear-screen case stays unseen. This is fixture evidence, not a universal minimum resolvable phone size.

Static saturated lights are rejected by temporal evidence; use exclusion ROIs when they overlap phones. The initial palette/thresholds need phone-camera experiments. Missing first pilots, severe motion, prolonged occlusion, very tiny/dim screens, auto exposure, rolling shutter, HEVC/HDR and venue lighting remain limitations; synthetic success does not establish physical recall. The auditorium reference photo is not calibrated geometry, and the fixture does not model the balcony or recover a 3D seating map.

## Admin review artifacts

With `--debug-dir`, `index.json` connects camera IDs to safe artifact filenames and includes final observations/locations plus each mapping matrix, support polygon and held-out residual. Each `camera-N.png` labels tracks on one preview (green accepted, orange other); `camera-N.json` contains phase, sampled symbols, interior counts, normalized pilots, trajectory, final status and reasons. Preview positions are nearest track samples and can be stale for a track absent at that instant; use `previewPtsMs` and trajectories for review.

These artifacts are worker-owned diagnostics, not a new frozen public API. Team 4 should use the frozen result for map rendering and display `mappingMode`, status and evidence. The backend must explicitly serve/restrict artifacts if the dashboard needs access. Keep raw footage and debug files in ignored runtime storage.

## Verification and next work

See [Team 3 handoff](../../.devcontext/teams/otc-localization/handoff.md), [parallel/perspective evidence](../../.devcontext/evidence/otc-localization/20260919-parallel-perspective.md), [initial evidence](../../.devcontext/evidence/otc-localization/20260919-pipeline.md), and [fixture tools](../../tools/otc-fixtures/README.md). Run `bun run gate:otc`; generator/benchmark lint additionally uses `.venv\Scripts\python.exe -m ruff check workers/otc tools/otc-fixtures`. Focused tests live under `workers/otc/tests/` and generate their own MP4s.

Current decoder `otc-v1.4` passes 90 Python tests and the shared gate. The original physical sample recovers IDs 9 and 11 with zero corrected/erased bits; the live single-camera job completes in 81.88 seconds and yields column-only results without anchors. See [current evidence](../../.devcontext/teams/otc-localization/journal/20260919-two-physical-screens.md). The v1.2 [integration audit](../../.devcontext/evidence/otc-localization/20260919-integration-audit.md) is historical. Run `bun tools/otc-fixtures/verify-handoff.ts` for generated clips through the actual worker and consumer TypeScript schemas; this remains synthetic boundary evidence. Shared wire schemas and packet version are unchanged.

On the recorded Ryzen 7 7840HS run, unchanged 1,500-ID 4K inputs took 97.80 seconds serial and 32.19 seconds with three camera workers; outputs are identical except processingMs. Sampled aggregate resident memory rose from 292.90 to 801.14 MiB. This is one synthetic comparison, not a hardware-independent or physical-venue guarantee.

The v1.2 audit rerun on those same inputs localized all 1,500 in 30.83 seconds, with an 805.49 MiB sampled aggregate resident peak. The curved auditorium fixture also decoded every ID, but its null anchors intentionally produce only coarse/ambiguous locations; see the audit for counts and limits.

The v1.4 rerun of the same clean 1,500-phone three-camera inputs localizes all 1,500 correctly in 54.42 seconds with ~810 MiB sampled aggregate resident memory. Two candidate masks cost more processing time than v1.2, but remain under the 90-second target on this machine. These scale results are synthetic; the original two-phone sample takes 81.88 seconds for its longer, cluttered 43.5-second recording.

Next physical proof: record independently labeled device IDs near and far with original camera files, audit visible-phone recall and false acceptance, then check three-camera geometry, runtime and memory. The two-screen sample establishes a narrow physical result; it does not verify venue-scale recall, seat geometry or complete concert acceptance.

API references: [PyAV containers](https://pyav.org/docs/stable/api/container.html), [OpenCV shapes/contours](https://docs.opencv.org/4.x/d3/dc0/group__imgproc__shape.html), [OpenCV homography](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html). Installed-library behavior is exercised by the tests.
