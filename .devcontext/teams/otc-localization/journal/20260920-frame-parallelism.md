# OTC performance investigation

Owner: integration captain on main; starting commit `7cbe031`, clean tree. User delegates detection and mapping accuracy to teammates; this session owns performance orchestration, profiling/benchmark tooling and narrowly scoped scan-loop integration only. Keep detector, association, packet decisions and geometry unchanged. No live jobs or audience state will be used for benchmarks.

Machine: AMD Ryzen 7 7840HS, eight physical cores / sixteen logical processors, 15.19 GiB usable RAM. Current implementation launches one process per supplied camera (at most three), limits each camera's OpenCV to one thread and codec to two threads, and analyzes frames sequentially. A higher camera process limit alone cannot accelerate a single clip.

Plan: profile the saved original five-phone recording and compare isolated, identical-input runs. First check native threading and independent frame detection; retain timestamp-ordered association. Adopt only a measured useful acceleration with bounded frame memory, deterministic equivalent results and failure cleanup. Run the OTC gate and real worker integration checks if production code changes. Record timings separately from earlier contended measurements and synthetic density claims.

Inputs: saved `runtime/local/five-phone-frame.manifest.json`, original SHA-256 `c06a58a0c04d1e36bc8ce815ea9900ad2d1e2c777e16da1573fa2cf569e97a18`. This is one 3840×2160, 444-frame physical clip with five known decoded phones; three-camera and dense synthetic comparisons are separate. Raw footage and detailed diagnostics remain ignored.

## Profiling and initial implementation

- User clarified the live Railway service can expose up to 24 CPUs. Automatic sizing must honor actual affinity/container quota rather than blindly spawning per-camera copies of the host CPU count. A shared CPU budget is divided across active cameras (24 means 24/12/8 analysis workers with one/two/three cameras); smaller allocations queue cameras. An explicit budget can cap resources but never override an observed smaller allocation.
- Full physical-clip profile took 202.79 s under cProfile: detection 112.68 s, ordered association 61.37 s, video read/decode/RGB 18.62 s, packet decode 3.40 s. Profiling adds overhead. Independent unprofiled original baseline: 150.998 s wall / 150.696 s reported processing; exactly the same five IDs. The previous 233.12 s contended run is not used as the baseline.
- Added a spawned per-frame process pool backed by a fixed ring of shared RGB buffers. Large images never cross IPC; tasks/results carry timestamps and candidates. The camera parent consumes every result in PTS order and retains all original tracking/geometry/packet decisions. Shared RawArray storage avoids requiring a large Linux `/dev/shm` mount. The bound is one frame slot per configured analysis worker, plus decoder/preview frames and per-worker detector scratch space.
- First focused verification: 15 tests pass in 17.06 s, covering ordered pixels/PTS, exclusions, bounded read-ahead, detector failures, abrupt worker exit, early iterator close, container CPU limits, 24-CPU allocation, and serial/parallel complete result/artifact equivalence. Initial physical parallel comparisons are running in isolation.

- First parallel-only physical comparison: four analysis workers **60.149 s (2.51× versus the 150.998 s original)**, eight **61.707 s**. Every result field except processing time matched, including floating-point positions, rejected observations, diagnostics and warnings. Sampled aggregate resident sums: 844.0 / 1374.0 MiB respectively (shared pages may be counted multiple times). More workers alone plateaued because the camera parent was doing serial tracking work.
- Follow-up performance changes retain the exact distance/footprint predicates but short-circuit distance rejection before computing footprints for out-of-range candidates. No detection or acceptance thresholds changed. PyAV now uses two codec threads with AUTO frame/slice threading; frames still retain decoded PTS order. Full original-result comparisons at budgets 1/4/8/16 are in progress.

Live app state and teammates' detection/mapping rules remain untouched. Railway 24-CPU throughput has not been measured locally.

## Final-code physical comparison

Identical original file; generated review artifacts disabled in both the original baseline and these isolated runs. `compare_performance.py` verifies every result field except processing time against the original baseline result. All five IDs, coordinates, rejected/background observations, scores, diagnostics and warnings match exactly.

| Version / analysis CPUs | Wall time | Relative to original 150.998 s | Sampled resident sum |
| --- | ---: | ---: | ---: |
| Original implementation, one camera | 150.998 s | 1× | Not sampled |
| Updated, 1 | 127.342 s | 1.19× | 374.3 MiB |
| Updated, 4 | 41.690 s | 3.62× | 955.0 MiB |
| Updated, 8 | 36.718 s | 4.11× | 1465.2 MiB |
| Updated, 16 | 38.123 s | 3.96× | 2552.8 MiB |

Artifacts: `runtime/local/otc-performance/final-physical/metrics.json` and per-budget results. Native thread CPU time can exceed elapsed time. Memory is a sampled sum of resident sets and may double-count shared pages; it is not private RAM consumption. These are single sequential trials on the development laptop, not a throughput guarantee. The 16-logical-CPU result is effectively a plateau relative to eight physical cores. CPU parallelism alone accounted for 2.51×; the full performance changes reach about 4× here. Additional cores on Railway may help three-camera work, but a deployed 24-CPU comparison remains necessary.

## Three-camera density comparison

The same existing three 4K synthetic recordings, 1,500 phones total, were processed sequentially at CPU budgets 3 and 16. Both runs include the ancillary distance-check/codec optimizations, so this comparison isolates adding frame workers beyond the existing one-per-camera layout:

- Budget 3, shares `[1,1,1]`: **68.961 s**, sampled resident sum 1035.3 MiB.
- Budget 16, shares `[6,5,5]`: **38.481 s**, sampled resident sum 3139.2 MiB; **1.79× faster**.
- All result fields excluding processing time match exactly. Independent ground truth: **1,500/1,500 localized, zero wrong columns/positions**, maximum canonical error 0.000530672 (tolerance 0.015).
- Artifacts: `runtime/local/otc-performance/dense-three-camera/metrics.json`. These clean generated 4K clips do not establish physical auditorium recall or cloud throughput.

## Final verification and handoff

- `OTC_CPU_BUDGET=3 bun run gate:otc`: **142 Python tests pass in 151.35 s**, plus the 14 contract tests, schema/fixture drift, boundaries, TypeScript and lint checks. The gate's budget bounds regression resource usage; focused tests explicitly exercise larger budgets, queued cameras, byte-identical debug artifacts, and 24-CPU quota allocation. Frame failures, an abrupt child exit, early consumer close, callback failure during frame processing and a closed parent pipe all clean up their workers. Benchmarks ran separately without competing test jobs.
- `python -m ruff check workers/otc tools/otc-fixtures` and `git diff --check`: pass (only the existing repository line-ending policy notice for `.env.example`).
- `bun run test:e2e` with automatic CPU sizing: **pass in 19.4 s**. Real HTTP/WebSocket service and Python worker process red/blue MP4 uploads, produce review artifacts/maps, enforce stale geometry, route/schedule music including manual late join, handle panic and persist a stopped restart. Evidence: `.devcontext/evidence/integration/local-e2e.md`, ignored artifacts `runtime/e2e/7b1ca354-d48b-4ad3-8df2-595e76929239`. This isolated harness uses synthetic recordings and an audio scheduling double; the live service was not restarted, flashed or mutated.
- Small raw benchmark reports are committed-context candidates under `.devcontext/evidence/otc-localization/20260920-{physical,three-camera}-cpu-scaling.json`; original recordings and full results remain ignored. The physical report starts with the optimized one-worker result; the separate pre-change 150.998 s baseline is preserved above and in the ignored `baseline-result.json` / `otc-performance-baseline.log`.
- Changed interfaces: optional Python/CLI `cpu_budget` / `--cpu-budget` and inherited backend `OTC_CPU_BUDGET`; no wire schema, packet, public API or dependency changes. The default backend command invokes current Python source, so the next processing attempt uses it without a backend restart. Set deployment environment variables before starting the Railway service.
- Teammate handoff: preserve the ordered `scan_camera` adapter and the same distance predicate moved ahead of expensive work. No changes to `detect_screens`, sampling/identity acceptance, or geometry. Shared frame inputs are read-only. Future detectors should return compact samples and avoid mutating input frames/exclusions.
- Remaining limits: 24-vCPU Railway benchmark and physical three-camera venue test. The supplied five-phone recording establishes exact old/new result equivalence for that file, not broader detection/mapping accuracy. Upload time is outside these CPU timings. Eight versus sixteen local workers already plateau; do not extrapolate a 24× speedup. The user's next action is to retry a processing job locally or set a Railway CPU ceiling and run the same comparison after deployment.
