# Optical fixture tools - Team 3

`generate.py` creates original H.264 MP4s, a validated manifest with actual SHA-256 hashes, and independently authored ground truth. It uses the frozen shared codebook to render symbols, but never calls the decoder to determine expected IDs or positions. Shared `fixtures/otc/clean-30` still contains only foundation JSON; use this generator for video.

After `bun run setup:python`, run from the repository root:

```powershell
.\.venv\Scripts\python.exe tools/otc-fixtures/generate.py --output-dir runtime/otc-demo --case clean --count 30 --seed 7
bun scripts/python.ts process --manifest runtime/otc-demo/manifest.json --output runtime/otc-demo/result.json --evidence synthetic --debug-dir runtime/otc-demo/debug
```

Use a new folder for each generated fixture. Defaults: three 640x360 cameras, 30 fps, 13.5 seconds, 10x16-pixel phones, 200 ms symbols and staggered camera start offsets. IDs include 0, 2047 and 1024. Anchors reverse stage-view orientation into the audience coordinate system. Frame rate options are 24/30/60; dimensions/count/seed are configurable for scale tests. Identical toolchains/seeds produce deterministic scenes; encoded hashes may differ across codec/platform versions, so use the newly generated manifest.

| Case | Evidence exercised |
| --- | --- |
| `clean` | Native small screens, three views/overlap, compression, static colored distractor |
| `degraded` | Hand motion, channel color gains, dropped frames, one-slot erasure, half-cover/uncover, one fully hidden phone |
| `vfr` | Nonuniform presentation times plus missing frames and motion |
| `rotated` | Raw camera rotation with explicit manifest correction |
| `wrong-tag` | Valid ID words from a different calibration tag |
| `duplicates` | Same optical ID at two positions, simulating a reflection |
| `crossing` | Two phones cross; conservative tracking must not swap accepted identities |
| `empty` | Distractor only, no phone screens |

The synthetic scenes do not model all sensor effects. Dense clean scenes test computational scaling; they do not establish crowded-venue recall or codec robustness on original phone files. Automatic overlap mathematics has separate tests; dense round trips can use manual anchors when common support is too narrow.

## Reproducible scale measurement

```powershell
.\.venv\Scripts\python.exe tools/otc-fixtures/generate.py --output-dir runtime/otc-density --count 1500 --width 3840 --height 2160 --fps 30 --seed 7
.\.venv\Scripts\python.exe tools/otc-fixtures/benchmark.py --manifest runtime/otc-density/manifest.json --truth runtime/otc-density/ground-truth.json --output-dir runtime/otc-density/benchmark
```

`benchmark.py` runs the real pipeline in its own Python process, writes validated `result.json`, records progress and outputs `metrics.json`. It checks canonical positions/columns against independent truth with a 0.015 distance tolerance, reports statuses, maximum error, wall time, worker time, input hashes/tool versions and peak resident memory. On Windows it measures the current Python process with `GetProcessMemoryInfo`, not the small virtualenv launcher. On POSIX it uses `getrusage(RUSAGE_SELF)`. Timings exclude generation, upload and Python import/startup, include result writing, and disable debug artifacts. Exit is nonzero for wrong localized positions or incomplete `clean` localization. Other cases intentionally contain hidden/rejected phones; status counts are not visible-phone recall.

Use `.venv/bin/python` on POSIX. Keep generated MP4s and debug artifacts under ignored runtime directories. Commit small reports/checksums, not original audience footage. See [recorded evidence](../../.devcontext/evidence/otc-localization/20260919-pipeline.md).
