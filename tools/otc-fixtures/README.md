# Optical fixture tools - Team 3

`generate.py` creates original H.264 MP4s, a validated manifest with actual SHA-256 hashes, and independently authored ground truth. It uses the frozen shared codebook to render symbols, but never calls the decoder to determine expected IDs or positions. Shared `fixtures/otc/clean-30` still contains only foundation JSON; use this generator for video.

After `bun run setup:python`, run from the repository root:

```powershell
.\.venv\Scripts\python.exe tools/otc-fixtures/generate.py --output-dir runtime/otc-demo --case clean --count 30 --seed 7
bun scripts/python.ts process --manifest runtime/otc-demo/manifest.json --output runtime/otc-demo/result.json --evidence synthetic --debug-dir runtime/otc-demo/debug
```

Use a new folder for each generated fixture. Defaults: three 640x360 cameras, 30 fps, 13.5 seconds, 10x16-pixel phones, 200 ms symbols and staggered camera start offsets. IDs include 0, 2047 and 1024. Anchors reverse stage-view orientation into the audience coordinate system. Frame rate options are 24/30/60; dimensions/count/seed are configurable for scale tests. Identical toolchains/seeds produce deterministic scenes; encoded hashes may differ across codec/platform versions, so use the newly generated manifest.

For the backend/admin producer-consumer handoff, run `bun tools/otc-fixtures/verify-handoff.ts`. It creates a fresh runtime folder, generates 30-phone clips, runs the actual three-camera Python CLI, parses its manifest/progress/result/map through the shared TypeScript schemas, verifies positions and debug consistency, and injects a bad hash to check failure behavior. The final output names the artifact directory. It requires no running backend or frontend, and does not establish live UI integration.

| Case | Evidence exercised |
| --- | --- |
| `clean` | Native small screens, three views/overlap, compression, static colored distractor |
| `degraded` | Hand motion, channel color gains, dropped frames, one-slot erasure, half-cover/uncover, one fully hidden phone |
| `emissive-background` | Washed-out amber/cyan screens against dim colored clothing and a thin glow bridge; unequal pilot brightness and dim screens in the same capture |
| `vfr` | Nonuniform presentation times plus missing frames and motion |
| `rotated` | Raw camera rotation with explicit manifest correction |
| `wrong-tag` | Valid ID words from a different calibration tag |
| `duplicates` | Same optical ID at two positions, simulating a reflection |
| `crossing` | Two phones cross; conservative tracking must not swap accepted identities |
| `empty` | Distractor only, no phone screens |
| `perspective` | Converging audience rows, compressed rear-row spacing, and smaller rear screens under an inverse-depth projection |
| `perspective-undersized` | Same perspective scene, with the last row deliberately reduced to 1x2 native pixels to verify conservative rejection below useful resolution |

## Perspective and back-row visibility

The perspective view is an original stylized stage-facing scene. It is inspired by the depth variation in the user's auditorium reference, not calibrated to that side-view photograph. Screen dimensions shrink by the same inverse-depth factor in both directions while the projected audience plane forms a trapezoid. Nearby screens therefore occupy much more image area, and rear rows have less pixel separation. The supplied photograph is not embedded in generated clips.

```powershell
.\.venv\Scripts\python.exe tools/otc-fixtures/generate.py --output-dir runtime/otc-fixtures/perspective --case perspective --count 90 --width 1280 --height 720 --seed 7
bun scripts/python.ts process --manifest runtime/otc-fixtures/perspective/manifest.json --output runtime/otc-fixtures/perspective/result.json --evidence synthetic --debug-dir runtime/otc-fixtures/perspective/debug
```

Open `camera-0.mp4`, `camera-1.mp4` or `camera-2.mp4` in that folder. This 90-phone sample has front screens of 37x59 pixels and rear screens of 12x18 pixels, about a tenfold difference in area. Its real pipeline result localized all 90 devices; maximum normalized position error was 0.00372. At 640x360, the 60-device automated fixture additionally exercises six-pixel-wide rear screens. All 60 localize correctly, including front/middle/back rows. With `perspective-undersized`, the 12 deliberately tiny last-row phones remain unseen and the other 48 localize correctly. These dimensions are synthetic observations, not a physical camera resolution guarantee.

Reducing the same 90-phone scene to 640x360 exposes a limit: 72 localize, 17 remain ambiguous and one stays unseen. All 196 accepted camera observations still match their true identities/positions; the unresolved positions are rear-row phones. Compressed row spacing, compression artifacts and conservative track association prevent full recall here even though the back screens are six pixels wide. This lower-resolution case remains an automated safety regression: front/middle phones must localize, uncertain positions stay null, and no accepted ID may move to another screen. The 90-phone full-recall test explicitly uses the review clip's 1280x720 resolution.

That recall limit describes v1.2. With v1.4's tighter footprint association, the same 90-phone 640x360 case recovers all phones correctly. Its regression checks every accepted observation against independent projected ID/position truth and permits improved recall; actual crossings, merged tracks and deliberately undersized screens still have separate rejection tests. This improvement is synthetic evidence and does not change the physical resolution caveat.

Perspective truth adds `depth`, `expectedUnresolvable`, and per-camera `cameraScreens` (ideal center, rendered width/height and visibility) to each independently positioned phone. Tests check camera observations against projected truth as well as final normalized locations; a later mapping rejection cannot conceal a wrong accepted ID. The 1x2 case is an explicit isolated resolution-limit injection, not an ordinary equal-size phone under the virtual camera.

Screen dimensions scale with image resolution, but do not shrink merely because `--count` increases. The 60/90-device scenarios isolate distance-dependent size variation. Arbitrarily increasing count can make screens and tracking neighborhoods overlap, especially in compressed rear rows; such input is allowed to produce ambiguous/unseen phones. The 1,500-device `clean` case below remains the computational scale fixture. Neither case establishes recall for a physical crowd or resolves parallax from auditorium tiers.

The synthetic scenes do not model all sensor effects. Dense clean scenes test computational scaling; they do not establish crowded-venue recall or codec robustness on original phone files. Automatic overlap mathematics has separate tests; dense round trips can use manual anchors when common support is too narrow.

## Reproducible scale measurement

For the separate 1,500-phone curved/tiered auditorium scene inspired by the reference image:

```powershell
.\.venv\Scripts\python.exe tools/otc-fixtures/auditorium.py --output-dir runtime/otc-fixtures/auditorium-1500
```

Open `overview.mp4` for the entire crowd, or `camera-left.mp4`, `camera-center.mp4`, `camera-right.mp4` for closer overlapping views. Each is 3840x2160, 30 fps, 13.5 seconds and renders the frozen OTC packet with original scene geometry. All 1,500 phones fit in the overview; label-raster checks confirm each has visible pixels before video compression. Preview PNGs, `scene.json`, independent `ground-truth.json` and a three-camera `manifest.json` are included.

This scene uses 30 curved rows, with seats increasing from 22 to 78 per row, three blocks, 0.58 m seat pitch and an additional 1.2 m gap at each aisle. Row radii run from 10 to 36.1 m; an increasing tier rise preserves sightlines in this stylized bowl. Every screen is 8x16 cm, projected as a quadrilateral facing the stage. Horizontal and vertical spacing therefore follow the row geometry and viewing perspective. Neutral seat backs and terrace edges make the sweep visible without transmitting IDs. The overview uses a 94-degree horizontal field of view; the three close views use 54 degrees from a common fixed stage origin, aimed at -27/0/+27 degrees.

These are explicit synthetic assumptions, not measurements extracted from the photograph. Balcony seating, people/body occlusion, hand movement, sensor effects and translated-camera parallax are omitted. The three-camera manifest intentionally has null anchors: the curved, raked bowl does not define a single planar audience homography. It can exercise ID decoding/coarse outcomes, but do not use the old full-coordinate benchmark to claim 1,500 localized seats from this scene. The overview is a viewing artifact, not a fourth manifest camera. Large media stays in ignored runtime; the generator is reproducible from Git.

The v1.2 [integration audit](../../.devcontext/evidence/otc-localization/20260919-integration-audit.md) recovered all 1,500 IDs from these three views, with 2,606 accepted observations and no independent identity mismatches. Without anchors, 448 locations are coarse and 1,052 are ambiguous; none has invented row coordinates. To verify a processed result against the projected phone geometry:

```powershell
.\.venv\Scripts\python.exe tools/otc-fixtures/check_auditorium.py --manifest runtime/otc-fixtures/auditorium-1500/manifest.json --truth runtime/otc-fixtures/auditorium-1500/ground-truth.json --result runtime/otc-fixtures/auditorium-1500/audit-v12/result.json
```

Run the worker first with fresh output/debug paths. The checker requires all IDs to be recovered, checks each accepted ID against the nearest clipped screen and its own polygon, applies the 2 px center tolerance to fully in-frame phones, and verifies coarse columns. Partial-screen centroid errors are reported separately because their full-screen centers can lie outside the frame. This is synthetic identity/column evidence, not a full localization or physical recall test.

The original constant-size grid remains useful for comparing processing performance:

```powershell
.\.venv\Scripts\python.exe tools/otc-fixtures/generate.py --output-dir runtime/otc-density --count 1500 --width 3840 --height 2160 --fps 30 --seed 7
.\.venv\Scripts\python.exe tools/otc-fixtures/benchmark.py --manifest runtime/otc-density/manifest.json --truth runtime/otc-density/ground-truth.json --output-dir runtime/otc-density/benchmark --workers 3
```

`benchmark.py` runs the real pipeline, writes validated `result.json`, records progress and outputs `metrics.json`. It checks canonical positions/columns against independent truth with a 0.015 distance tolerance, reports statuses, maximum error, wall time, worker time and input hashes/tool versions. Choose `--workers 1` for a sequential baseline or `--workers 3` (default) for concurrent cameras; use a fresh output directory for each run. Timings exclude generation, upload and Python import/startup, include result writing, and disable debug artifacts.

Windows memory reporting separates the parent's lifetime peak (`parentPeakResidentBytes`) from the largest sampled live working-set sum of parent and descendants (`peakSampledProcessTreeResidentBytes`, every 100ms). The latter captures camera workers but can count shared pages repeatedly and miss peaks between samples; incomplete samples are excluded and counted. It measures actual Python processes, not just the virtualenv launcher. On other platforms aggregate memory is unavailable (`null`); the parent peak still uses `getrusage(RUSAGE_SELF)`.

Exit is nonzero for wrong localized positions or incomplete `clean` localization. Perspective metrics also group recall by depth and rendered minimum screen dimension, check accepted camera IDs against projected positions, and require marked undersized phones to stay unaccepted. Other cases intentionally contain hidden/rejected phones; overall status counts are not physical visible-phone recall.

Use `.venv/bin/python` on POSIX. Keep generated MP4s and debug artifacts under ignored runtime directories. Commit small reports/checksums, not original audience footage. See [parallel/perspective evidence](../../.devcontext/evidence/otc-localization/20260919-parallel-perspective.md) and [initial evidence](../../.devcontext/evidence/otc-localization/20260919-pipeline.md).
