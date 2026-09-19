# OTC implementation session

Status: first software slice ready for integration; physical stage remains in progress. Team 3, feat/otc-localization. Baseline: ab59c27105627977ee52dc2bcd4276b4532b9e2a (foundation-v1).

## Goal, assumptions and ownership

Implement the first real MP4-to-location worker path against frozen protocol v1. Own workers/otc/, tools/otc-fixtures/, this team's context and stage. Shared schemas/root scripts remain captain-owned.

- Real recordings have not been supplied yet; an early question requests local paths/camera details. Work proceeds with explicit synthetic footage and independently authored ground truth.
- Preserve the 55-symbol/200 ms packet. Both bounded-error ID passes must agree for automatic acceptance. Run tags are verified exactly, never error-corrected to the expected run.
- Cameras are stationary; use original frame PTS and declared clockwise rotation. Map anchors define approximate audience columns, not metric geometry.
- First target is a reproducible small multi-camera round trip with clear rejected/unknown cases. Real optics, scale and venue recall remain unverified.
- PyAV/NumPy/OpenCV dependencies belong to the worker's Python manifest/lock; captain review is required before integration, not a root lock edit.

## Plan and checks

1. Characterize baseline and implement bounded packet decoder -> exhaustive IDs/single-bit/double-bit cases, erasures, membership, tags and conflicting passes.
2. Add pinned video dependencies, PTS/rotation reader and seeded MP4 generator -> actual codec round trip and independent timing/position truth.
3. Track screens/sample pilots and symbols, implement manual mapping and conservative fusion -> clean/degraded/missing/duplicate/rotation fixtures and schema-valid results.
4. Wire process CLI with hash checks, progress, diagnostics and atomic output -> real command success/failure tests, full gate:otc, update stage/status/handoff and semantic commit.

## Baseline observations

- Branch switched from clean main to the published Team 3 branch.
- Baseline gate passes (10 Python tests). Root Bun test:contracts uses a substring filter and additionally discovers two retained runtime/isolation copies: 42 reported tests are three copies of the 14 tests. This is a captain-owned harness issue; use explicit ./packages/contracts/tests when reporting unique checks. Do not modify root scripts from Team 3.
- Existing manifest/result schemas support the required first slice. Extra per-track symbol/trajectory evidence can be written as debug artifacts, without changing the wire schema.
- Consulted primary PyAV container/frame APIs and OpenCV connected-components/homography documentation. Timing follows PTS, never nominal frame count divided by frame rate.

## First implementation evidence

- User confirmed there is no real footage because Team 2 has not built flashing yet. Generated MP4s now provide an independent development path, with positions authored before decoding. Real recording evaluation remains deferred, not blocked software work.
- Decoder tests initially failed on the missing module, then passed all 2,048 IDs, 32,768 single-bit errors, 245,760 double-bit errors, representative exhaustive erasures and conflicting/tag/membership cases.
- Pinned PyAV 18.1.0, NumPy 2.4.6 and OpenCV headless 4.13.0.92 in the worker's manifest/lock. No root dependency/config or shared schema changes.
- First actual 3-camera H.264 fixture round trip localized all 30 IDs with maximum normalized position error 0.002925; measured worker time 8.38 seconds on this Windows machine at 640x360. This is synthetic small-resolution evidence only.
- Initial video suite: 12 passed, one failed. The half-cover/uncover case falsely flagged device 3 because size was compared with the previous half-visible frame. Changed it to compare with the original screen footprint and added direct cover/merge regression tests; the same acceptance assertion is retained.
- Single physical camera failure policy: manifest may omit an unavailable camera; declared files must all exist and match hashes. No missing/hash-invalid input is silently removed from a submitted manifest.
- CLI now requires explicit --evidence synthetic|physical and supports --job-id/--debug-dir. Relative video paths resolve against the manifest directory. These worker-owned options will be documented in the Team 1 handoff; shared JSON schemas stay unchanged.

## Scale, optimization and final handoff

- Full pre-optimization gate passed 63 Python tests. Direct contract path confirms 14 unique tests / 6,171 assertions; root's 42 count includes retained isolation copies.
- Generated 3 x 3840x2160 / 30 fps / 13.5-second H.264 clips, seed 7, 1,500 IDs and 10x16-pixel screens. Baseline localized all 1,500 with no wrong columns/positions at 0.015 tolerance, maximum error 0.00058544; 138.15 seconds CLI wall missed the 90-second target.
- Profiling one camera found full-frame connected-component labeling dominant; local contour microbenchmark was ~5.7 ms versus labels ~42 ms. Replaced full-frame integer labels with contour boundaries/local masks preserving holes/islands, and reused normalized color arrays across phase hypotheses. No acceptance thresholds changed.
- Added a hole/island regression. Its first fixture accidentally placed no colored pixels within the detector's inner crop (and initially exceeded the large-object cutoff); adjusted the authored hole/frame dimensions to test the intended two visible interior colors. Production thresholds stayed unchanged. The final regression and full video suite pass.
- Optimized dense run: all 1,500 correct, same maximum position error; 96.19 seconds wall including validation/result writing, 95.35 seconds processing, 344,621,056 bytes / 328.66 MiB peak resident memory. Runtime remains above target. Added a reproducible benchmark script; no debug generation/upload/startup is included in that measurement.
- Earlier PowerShell 4,841,472-byte memory reading was invalid: it measured the virtualenv launcher. Final tool measures PeakWorkingSetSize inside the actual worker interpreter. Preserved baseline/optimized artifacts separately under ignored runtime and committed compact metrics/checksums.
- Final gate: 64 Python tests passed in 100.81 seconds; shared schema/fixtures/boundaries/typecheck/lint/contracts passed. Fixture-tool Ruff passed; pip check found no broken dependencies. No hosted CI or physical/browser tests ran.
- Updated worker/tool READMEs, Team 3 stage/status/handoff and evidence. Team 1 receives CLI flags/progress/exit semantics; Team 4 receives coordinate/anchor/artifact semantics. Captain follow-ups: Python pin review, root contract filter and stale shared foundation descriptions. Shared/root/other-team files and BeatSync reference remain unchanged.
- Next: integrate Team 2 flashing and record known IDs near/far before claiming physical recall. Remaining risks: original codecs/HDR, exposure/rolling shutter, severe motion, real overlap/parallax and processing target.
