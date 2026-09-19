# Parallel cameras and perspective evidence - 2026-09-19

Branch: feat/otc-localization. Baseline: 49328c3. Tested working tree: committed with this report, decoderVersion otc-v1.1. Wire protocol/codebook/dependencies unchanged. All recordings below are synthetic; the user's auditorium photograph is visual context, not measured geometry or footage.

## Parallel processing result

Default processing now spawns one independent process per supplied camera (at most three). Each child has one OpenCV thread and two decoder threads. It retains sequential frame tracking, writes disjoint debug artifacts, and returns compact observations. The parent verifies hashes, forwards progress, merges in manifest order, registers views and atomically publishes the validated result. Serial reference: --workers 1. Default parallel: --workers 3.

Six new real-MP4 tests cover exact serial/parallel equality except processingMs, shuffled camera order, distinct child PIDs, parent-only monotonic progress, artifact consistency, corrupt input, abrupt child termination, callback exceptions, and CLI success/failure. Focused suite: 6 passed in 14.78 seconds. No child remains after the tested failure paths. Direct Python callers need a main guard for spawn; forced backend cancellation must terminate the entire process tree.

## Same-input 1,500-ID comparison

Machine/toolchain match the [initial report](20260919-pipeline.md): AMD Ryzen 7 7840HS, Windows 11, Python 3.13.15, PyAV 18.1.0, OpenCV 4.13.0, NumPy 2.4.6. Input set is unchanged: seed 7, three 3840x2160 H.264 clips, 30 fps, 405 frames / 13.5 seconds each. Other agent test jobs were paused; runs were sequential, not competing.

| Measurement | Serial reference | Three camera processes |
| --- | --- | --- |
| Localized / participating | 1,500 / 1,500 | 1,500 / 1,500 |
| Wrong accepted final positions/columns at 0.015 tolerance | 0 | 0 |
| Maximum normalized position error | 0.0005854409361926471 | 0.0005854409361926471 |
| Wall seconds, including validation/result writing | 97.8005 | 32.1931 |
| Worker processing seconds | 97.0855 | 31.6364 |
| Peak sampled process-tree resident bytes | 307,130,368 | 840,060,928 |
| Peak sampled process-tree resident MiB | 292.90 | 801.14 |
| Maximum sampled process count | 1 | 4 (parent + 3 cameras) |

Results match exactly after removing processingMs. Observed speedup is approximately 3.04x on this pair of runs; cache/load/thermal variation can affect timing, so this is not a universal speedup promise. The 90-second initial target is now met on these clean synthetic clips. Original venue recordings and review-enabled processing remain unmeasured at this scale.

Raw reports (include exact input hashes): [serial](density-1500-serial-v11.json), [parallel](density-1500-parallel-v11.json). Reproduce from repository root after setup:python:

```powershell
.\.venv\Scripts\python.exe tools/otc-fixtures/benchmark.py --manifest runtime/otc-fixtures/density-1500/manifest.json --truth runtime/otc-fixtures/density-1500/ground-truth.json --output-dir runtime/otc-fixtures/density-1500/serial-v11 --workers 1
.\.venv\Scripts\python.exe tools/otc-fixtures/benchmark.py --manifest runtime/otc-fixtures/density-1500/manifest.json --truth runtime/otc-fixtures/density-1500/ground-truth.json --output-dir runtime/otc-fixtures/density-1500/parallel-v11 --workers 3
```

Use new output directory names on a rerun; generator commands are in the [fixture README](../../../tools/otc-fixtures/README.md). Timing excludes generation/upload/parent import/startup and disables debug output; includes child startup. Windows memory samples live working-set sums for parent and descendants at a nominal 100ms interval (plus sampler work), with no missing samples/errors in these runs. Shared pages may be counted more than once and transient peaks can be missed. Parent lifetime peaks are separately labeled in JSON; they are not total worker memory. Other-platform aggregate measurement is unavailable, not zero.

## Perspective and resolution evidence

New perspective scenes use inverse-depth screen dimensions and a projective trapezoid: large nearby phones, smaller distant phones, converging columns and compressed rear-row spacing. Independent truth includes canonical positions/depth and per-camera projected centers, rendered pixel sizes and actual rounded-bbox visibility. The decoder/tracker acceptance thresholds did not change.

- 60-phone 640x360 scene: all 60 localize, including ordinary back-row screens six pixels wide; accepted camera observations are within 2 pixels of their true device centers and final positions within 0.015.
- Resolution-limit variant: twelve rear phones are intentionally 1x2 pixels. They remain unseen; the other 48 localize correctly. No nearest-ID guess or lowered confidence threshold is used.
- 90-phone 1280x720 review scene: all 90 localize with correct columns; max canonical error 0.003719747. Front sizes 23-37 x 36-59 px, middle 16-19 x 26-30 px, back 12-14 x 18-23 px. The largest front screen has roughly ten times the area of the smallest rear screen.

| Review depth | Localized / expected resolvable |
| --- | --- |
| Front | 36 / 36 |
| Middle | 24 / 24 |
| Back | 30 / 30 |

Final perspective benchmark: 4.8596 seconds wall, 302,555,136 bytes sampled aggregate resident memory, no wrong accepted camera observations, missing resolvable phones or accepted undersized IDs. [Metrics and hashes](perspective-90-metrics.json).

Reviewable local clips: runtime/otc-fixtures/perspective/camera-0.mp4, camera-1.mp4, camera-2.mp4. That folder also holds preview.png, result.json, manifest/ground truth, debug/ and benchmark/. Generated media is ignored; repository contains the generator and small text reports. Frame previews were visually inspected for increasing screen size toward the camera.

A stricter observation-level check caught a truth-only edge bug: device 54 in the 90-phone sample had ideal x=7.44186 with width 16; raster rounding places its left edge at zero and renders it fully, but continuous-bound truth marked it invisible. Truth now follows the exact rounded bounding box. MP4 pixels and decoder behavior did not change. An additional 90-device automated case protects this boundary.

The first combined gate exposed a test-resolution mismatch: the new 90-phone full-recall test used the helper's 640x360 default instead of the 1280x720 review resolution. Investigation at 640x360 found 72 localized, 17 ambiguous, one unseen, with all 196 accepted camera observations correct (under 0.87 px error). Rear-row compression/codec fragmentation triggered conservative association/merge rejection; accepted alternate views outside validated map support could not rescue the location. The full-recall test now explicitly uses 1280x720, and the original 640x360 input remains a separate regression requiring no incorrect accepted identities, null uncertain coordinates and visible rejection. The 60-phone 640x360 full-recall requirement is retained. No production threshold was changed to accommodate this failure.

Fixed screen-to-scene dimensions mean arbitrarily increasing perspective --count can produce overlaps and conservative rejections. The 60/90-phone scenes isolate size variation; the separate 1,500-phone clean set measures throughput. Neither recreates all optics/occlusion of a packed auditorium, and no 1,500-phone perspective recall claim is made. The photo's balcony and tiered-seat parallax are not calibrated by this synthetic model. Handheld stabilization remains unimplemented.

## Final checks and next consumer action

Final `bun run gate:otc`: **74 Python tests passed in 105.23 seconds**, plus shared schema/fixture drift, reference/mock boundaries, TS typecheck, ESLint, Ruff and contract checks. Initial combined run: 72 passed, one failed on the resolution mismatch above. Final focused perspective suite: four passed in 26.72 seconds; focused parallel suite: six passed in 14.78 seconds. Ruff for worker/tools, git diff --check and local documentation links pass. The pre-existing root contract filter still counts two ignored isolation copies (42 reported = 14 unique tests repeated); captain owns that correction. No physical/browser/hosted-CI evidence is added.

Team 1 can keep its worker CLI call: parallelism is default. Add process-tree termination to forced cancellation; --workers 1 is available for diagnosis. Team 4 keeps the same result/artifact formats. Team 2 still supplies the next physical validation opportunity: film known IDs at front/back and compare actual pixel sizes, visibility, exposure and codec behavior before promising venue performance.
