# Team 3 integration handoff

Current integrated-main update: **otc-v1.4**, 90 Python tests passing, two physical screens decoded as 9 and 11 in the user's sample. Read the [two-screen investigation](journal/20260919-two-physical-screens.md) before continuing: bright/dim segmentation and footprint/brightness association changed; packet acceptance did not. The single-camera result is column-only without anchors and remains uncommitted. Merge origin/main into the team branch to obtain these captain fixes. The earlier v1.2 branch evidence below is historical, including its scale measurements.

Branch: feat/otc-localization; baseline foundation-v1 (ab59c27105627977ee52dc2bcd4276b4532b9e2a). Feature commit: resolve with `git log -1 --format=%H -- workers/otc/src/otc/pipeline.py`. **Ready for software integration**, verified against masterplan sections 5/8/9 in the [integration audit](../../evidence/otc-localization/20260919-integration-audit.md). Stage remains in progress pending physical validation. Check Git for publication status; a local commit is not a push.

## Run independently

From repository root after installing Bun 1.3.14 and Python 3.13:

```powershell
bun run setup:python
.\.venv\Scripts\python.exe tools/otc-fixtures/generate.py --output-dir runtime/otc-handoff --count 30 --seed 7
bun scripts/python.ts process --manifest runtime/otc-handoff/manifest.json --output runtime/otc-handoff/result.json --evidence synthetic --job-id handoff-job --debug-dir runtime/otc-handoff/debug
bun run gate:otc
.\.venv\Scripts\python.exe -m ruff check workers/otc tools/otc-fixtures
```

Use fresh output/debug paths for each attempt. POSIX Python: .venv/bin/python. The generator supplies original H.264 scenes, independent truth and manifest hashes. Expected clean result: all 30 IDs localized, correct columns, canonical distance error below 0.015; static light rejected. This is synthetic evidence.

Consumers can run one reproducible boundary proof after setup: `bun tools/otc-fixtures/verify-handoff.ts`. It generates fresh MP4s, invokes the real CLI, checks 30 correct locations and debug consistency, validates the manifest/progress/result/map in shared TypeScript schemas, and verifies a bad hash produces no success. It prints the fresh runtime artifact directory. This does not require or simulate the authoritative backend.

## Team 1: worker lifecycle

- Spawn the repo environment with argument arrays: python -m otc process --manifest ... --output ... --evidence ... --job-id ... . No shell interpolation of upload filenames.
- Required new option: --evidence synthetic|physical. Optional --job-id defaults to runId; --debug-dir emits review files. No shared schemas/codebook changed.
- Parallel cameras are default (--workers 3); each supplied camera gets one spawned process with OpenCV one thread / codec two threads. --workers 1 is the serial reference. Output ordering and schema stay unchanged; decoderVersion is otc-v1.2. Direct Python API callers must protect their entry point with a main guard for spawn; backend should invoke the CLI.
- Stdout is schema-valid JobProgress NDJSON. Its fraction never decreases but can repeat; decode/track stages may interleave across cameras. Stderr has JSON diagnostics for handled failures. Treat every nonzero exit/crash as failure; no failed progress event is promised.
- Exit 0 and complete event follow validated atomic output. Existing output files are refused. Keep each attempt isolated; backend owns timeout/cancellation. Forced cancellation must kill the process tree so camera children do not survive. Handled camera errors/abrupt child exits/callback exceptions clean up siblings. Partial debug files are not success.
- Recheck current sessionId/serverEpoch/runId/runTag/input hashes before authoritative map publication. Never silently use synthetic results as physical audience observations.
- Expose a candidate OtcResult for review before authoritative commit, plus controlled access to debug artifacts. Agree these HTTP resource endpoints with Team 4; the CLI payload does not define the job resource lifecycle. Apply the masterplan's target-only map replacement and stale-run/revision checks in the backend.
- All declared inputs must exist and match hashes. Omit unavailable cameras from the submitted manifest; relative paths resolve against its directory.
- Captain reviews worker Python manifest/lock pins before merge: PyAV 18.1.0, NumPy 2.4.6, OpenCV headless 4.13.0.92. No root/JS dependency edits.

## Team 4: mapping and review

- Use frozen result.locations. Only localized has coordinates; coarse/ambiguous/unseen have null x/y. Show status, evidence and mappingMode; decodeScore is not a probability.
- Anchors are audience front-left/front-right/back-right/back-left in image pixels after declared clockwise rotation. They map the primary column into its canonical third. x is audience left-to-right, y front-to-back; exclusions use the same rotated image space.
- Route rotation, anchors and exclusions into the eventual CameraInput through Team 1's upload/job metadata path. At inspected admin ref 95189af, uploads carry file/camera ID/column only; anchor-entry and uncommitted-result review remain integration work. A complete worker job alone is not a reviewed/committed map.
- debug/index.json links camera IDs to camera-N.png / camera-N.json and supplies final observations, matrices, support hulls and held-out residuals. Track files contain sampled symbols/counts, pilot colors, trajectories, status and reasons. These are worker diagnostics, not a frozen wire extension; coordinate backend artifact access.
- Duplicate optical IDs in one view remain ambiguous globally. Conflicting camera positions are not silently averaged. Manual anchors take precedence inside the primary ROI; validated overlap extends outside it. Agreeing views prefer the primary-ROI position, then decode score. This fixes a bug where overlap could conceal contradictory column anchors.

## Evidence and remaining work

Latest [integration audit](../../evidence/otc-localization/20260919-integration-audit.md): 79 Python tests and shared gate pass; the new cross-language CLI handoff passes. Fresh v1.2 dense run: 1,500/1,500 correct in 30.83 seconds, sampled aggregate resident peak 805.49 MiB. The new curved scene also recovers all 1,500 IDs, but null anchors yield 448 coarse / 1,052 ambiguous locations, zero full positions. No physical or integrated backend/UI evidence is claimed.

See [new evidence](../../evidence/otc-localization/20260919-parallel-perspective.md) and [new journal](journal/20260919-parallel-perspective.md); [initial report](../../evidence/otc-localization/20260919-pipeline.md) remains historical. Same-input dense result: 1,500 correct locations, 97.80 seconds serial versus 32.19 parallel (~3x); sampled aggregate memory 292.90 versus 801.14 MiB. Initial 90-second target is met on clean synthetic input.

New viewable clips: runtime/otc-fixtures/perspective/camera-0.mp4 through camera-2.mp4 (90 phones, 1280x720), preview.png and debug/. Larger foreground / smaller rear screens and converging rows are generated from independent projective geometry. Review result: 90/90 localized across front/middle/back, widths 37 down to 12 pixels. Automated 640x360 tests cover six-pixel ordinary rear screens and deliberate 1x2-pixel phones staying unseen. The photo is a reference, not a calibrated venue model; density beyond these perspective fixtures may introduce overlaps. No physical clips exist yet; HEVC/HDR, rolling shutter/exposure, real back-row visibility, crowd motion and parallax remain unverified. Handheld stabilization is unchanged and still absent.

Additional large viewing scene: `python tools/otc-fixtures/auditorium.py --output-dir runtime/otc-fixtures/auditorium-1500` produces a 1,500-phone 4K overview and three closer camera clips with 30 curved/raked rows, aisles, neutral seat backs and physical-size screen projection. See [scene evidence](../../evidence/otc-localization/20260919-auditorium-sweep.md). Independent 3D truth is included; manifest anchors remain null because this bowl is not a single canonical plane. No full-localization benchmark is claimed for this new scene. Original constant-size and smaller perspective regression fixtures are unchanged.

Captain follow-ups: after accepting this branch, update root masterplan/README and shared context statements describing the worker as pending. The pre-existing root test:contracts substring filter discovers two ignored runtime/isolation copies on this machine: 42 reported tests are three copies of 14 unique tests. Proposed captain fix: `bun test ./packages/contracts/tests`. Root files remain unchanged.

Next Team 3 action: integrate Team 2's exact renderer, film a known-ID group near/far, inspect annotated tracks, and change thresholds only with evidence; then evaluate original three-camera 4K recordings. Do not shorten the packet or loosen identity acceptance to make the demo appear successful.
