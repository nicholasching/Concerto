# Team 3 integration readiness - 2026-09-19

Decision: **ready for software integration against frozen protocol v1**. Stage 03 remains in progress until physical acceptance. This audit found and fixed a geometry conflict bug; no remaining Team 3 software blocker was found in the reviewed scope. This is not an end-to-end concert or venue sign-off.

Baseline: `53dd0a8`; final code is the commit containing this report, decoder `otc-v1.2`. Packet/codebook remain `otc-v1` / `hamming16-11-v1`. No shared schemas, root dependencies, other teams' files or BeatSync source changed. Python dependency pins from the earlier implementation still require captain review before merge.

## Requirement-to-evidence review

| Masterplan requirement | Implementation / evidence | Readiness |
| --- | --- | --- |
| §5.2 frozen 55-slot packet; all IDs including 0; bounded errors/erasures; exact tag | `protocol.py`; exhaustive 2,048 IDs, 32,768 single-bit corrections, 245,760 double-bit rejections; tag/membership/pass-conflict tests | Software verified; physical symbol rendering pending Team 2 |
| §5.4 input identity/hashes, actual PTS, rotation, streaming | `validation.py`, `video.py`; hash failure before cameras start, relative paths, VFR and 24/30/60 fps, rotated MP4 and malformed timestamp tests | Verified on synthetic H.264; original HEVC/HDR pending |
| §5.4 phase, native screen sizes, motion/occlusion and rejection | `tracking.py`, `sampling.py`; pilot-only bounded phase fitting, interior samples, erasures, crossings/reflections/partial cover/hidden screens, front/back perspective tests | Synthetic checks pass; no global handheld-camera stabilization, consistent with stationary-camera plan |
| §5.5 primary-column anchors, audience orientation, overlap support and conflicts | `geometry.py`; ordered native-pixel anchors, >=8 distributed pairs, held-out residuals, support hull, disconnected/manual/coarse fallback; three new regression checks below | Ready after this audit's fix |
| §5.4 camera parallelism / control-process isolation | `camera_worker.py`; actual three spawned worker PIDs, deterministic serial/parallel output, camera failure/abrupt exit/callback cleanup tests | Ready; backend must terminate the whole tree on forced cancellation |
| §5.4 diagnostics and review | Atomic validated result, NDJSON progress, annotated previews, trajectories/symbols/rejection reasons/mapping support; debug observations match final result | Ready as worker outputs; authenticated artifact/result serving belongs to Team 1 |
| §8 TS/Python compatibility | Real process CLI generates 30 correct locations; its manifest, progress, result, audience map and insertion into an admin snapshot parse through consumer Zod schemas | Passed, independent of other branches; not a live backend/UI test |
| §8 1,500-device processing target <=90 s | Fresh v1.2 clean grid: 1,500/1,500 correct, max normalized error 0.00058544; 30.83 s wall time, sampled aggregate resident peak 805.49 MiB | Target met on this synthetic set / Ryzen 7 7840HS; physical throughput pending |
| §8 near/back-row realism | 60/90-phone perspective regression tests; 1,500-phone curved/tiered scene now decoded with 2,606 accepted observations covering every ID | All IDs recovered in new synthetic scene; no full seat map without anchors |
| §9 uploads -> worker -> candidate review -> commit -> intended phone/channel | CLI side verified; other branches still need worker lifecycle, camera geometry input, candidate-result API/review, packet renderer and authoritative commit | Integration work remains with Teams 1/2/4 |
| §8 field recall / §12 completion | No physical phone recordings, original three-camera calibration or live audio-routing round trip yet | Pending; must not call stage verified or concert ready |

## Fixed finding: overlap concealed contradictory primary anchors

Two cameras can report identical, well-spread common IDs while their operator anchors put that same region in different columns. Previously `build_mappings` inserted the overlap mapping before each independent manual mapping. Both views then inherited one column and appeared to agree, silently concealing the contradiction. A nine-ID regression failed on the original implementation.

Manual primary-column ROI mappings now take precedence; validated overlap only extends coverage outside them or supplies an unanchored view. Contradictory mapped positions remain ambiguous. When views agree, the reported point prefers a valid primary ROI, then decode score, as §5.5 specifies. `mappingMode` identifies the chosen point's mapping; source cameras and residual diagnostics retain corroborating evidence. Three regressions verify conflicting anchors, useful overlap outside the primary ROI, and primary-view preference. All 11 geometry tests pass. No thresholds, packet fields or acceptance targets were loosened.

## Exact verification

Commands below run from the repository root after `bun run setup:python` (local Bun path was used on this machine).

```powershell
bun run gate:otc
bun test ./packages/contracts/tests
.\.venv\Scripts\python.exe -m ruff check workers/otc tools/otc-fixtures
.\.venv\Scripts\python.exe -m pip check
bun tools/otc-fixtures/verify-handoff.ts
git diff --check
```

- Baseline gate: 76 Python tests passed in 93.67 s. Final gate after fix: **79 Python tests passed in 85.74 s**, plus schema/fixture drift, boundaries, TypeScript, ESLint, worker Ruff and contracts.
- Direct contract path: **14 unique tests / 6,171 assertions** pass. The root gate's pre-existing substring filter also finds two ignored isolation copies (42 reported = three copies of 14); captain follow-up remains `bun test ./packages/contracts/tests`.
- Worker and fixture-tool Ruff pass; `pip check` reports no broken requirements; whitespace check passes.
- New reproducible `verify-handoff.ts`: generates actual MP4s in a fresh runtime directory, executes the three-camera CLI with relative video paths, parses every progress record in TypeScript, verifies all 30 ID/column/positions, checks output identity/hashes and debug consistency, then injects a bad hash and verifies exit 2 with no result or complete event. Maximum position error 0.00292455. It also validates the result as an `AudienceMap` inside an `AdminSnapshot`; this validates shapes, not server revision/authorization behavior. [Recorded summary](integration-handoff-v12.json). Artifacts for this run: `runtime/otc-handoff-lqoOBn/`.
- Fresh dense benchmark: [metrics](density-1500-parallel-v12.json); `runtime/otc-fixtures/density-1500/parallel-v12/`. Same three input hashes as the prior v1.1 comparison. Timings exclude generation/upload/import startup, include result validation/write, disable debug. Memory is the 100 ms sampled sum of live parent/child working sets; shared pages can be counted repeatedly and intervening peaks missed.

```powershell
.\.venv\Scripts\python.exe tools/otc-fixtures/benchmark.py --manifest runtime/otc-fixtures/density-1500/manifest.json --truth runtime/otc-fixtures/density-1500/ground-truth.json --output-dir runtime/otc-fixtures/density-1500/parallel-v12 --workers 3
```

Generate the clean clips with `generate.py --count 1500 --width 3840 --height 2160 --seed 7` first if absent. Use a fresh output directory on reruns.

## Curved auditorium result and its limits

The new large scene was a viewing fixture in `53dd0a8`; this audit additionally ran its three original generated camera files through the worker, with debug enabled. All **1,500 unique IDs** were recovered in **2,606 accepted observations**. Independent projected-screen checks found no wrong IDs: nearest visible screen must match the decoded ID and the center must lie within its own polygon, allowing one pixel for rasterization. Fully in-frame screen centers retain the existing 2 px tolerance; maximum error was 1.17645 px. Ten accepted screens are clipped at the frame edge; their clipped-centroid errors are reported separately, not compared to off-frame full-screen centers. Injecting two swapped IDs into the result makes the independent checker flag both.

The first exploratory check compared every center with an unclipped full-screen center and flagged seven edge observations. All seven were partially out of frame. The committed checker handles that geometry explicitly; no production acceptance threshold changed. [Final identity/column report](auditorium-1500-identity-v12.json).

With null anchors, the scene yields **448 coarse, 1,052 ambiguous, zero localized** locations. All 448 coarse columns match truth. Shared IDs alone cannot orient an unanchored camera graph into a canonical seat map, and different cameras' primary-column labels are not enough to resolve overlapping views. This is expected fallback behavior, not a 1,500-seat localization claim. Worker `processingMs` was 38.36 s; it excludes final debug annotation/write, so it is not a full end-to-end benchmark.

```powershell
bun scripts/python.ts process --manifest runtime/otc-fixtures/auditorium-1500/manifest.json --output runtime/otc-fixtures/auditorium-1500/audit-v12/result.json --evidence synthetic --job-id auditorium-audit --debug-dir runtime/otc-fixtures/auditorium-1500/audit-v12/debug
.\.venv\Scripts\python.exe tools/otc-fixtures/check_auditorium.py --manifest runtime/otc-fixtures/auditorium-1500/manifest.json --truth runtime/otc-fixtures/auditorium-1500/ground-truth.json --result runtime/otc-fixtures/auditorium-1500/audit-v12/result.json
```

Use `auditorium.py --output-dir ...` to generate absent media, and fresh output/debug directories on reruns. This scene still omits people, sensor effects and camera translation; it is not field evidence.

## Other-branch inspection and next consumer actions

Remote refs were fetched and inspected without switching/merging their worktrees: Team 1 `ab59c27` (foundation shell), Team 2 `45625bc` (join/audio slices; packet renderer pending), Team 4 `95189af` (review remediation; candidate-result boundary pending). Neither available client/admin branch changes shared OTC contracts. Their status files and source were inspected; their gates and a speculative combined merge were not run here.

1. **Team 1 / captain:** run `bun tools/otc-fixtures/verify-handoff.ts`, then spawn the CLI with explicit evidence/job ID and unique output/debug directories. Forward progress; publish success only after zero exit plus validated result. Own timeout/process-tree cancellation, upload file/hash immutability, current session/epoch/run/hash rechecks, participant-set map replacement, stale-result refusal and synthetic/physical separation. Agree the job resource / candidate-result and artifact HTTP endpoints with Team 4; the worker's `OtcResult` is ready, but the HTTP resource lifecycle is not defined by that payload alone.
2. **Team 4 with Team 1:** supply rotation, exclusions and the four ordered native-pixel primary-column anchors into the eventual `CameraInput` manifest, using the same rotated preview space. Current upload adapter sends file/camera ID/column only; there is no anchor-entry or uncommitted `OtcResult` review path yet. Display candidate diagnostics/status/mappingMode/evidence before map commit. No anchors means no promised row coordinates. A worker complete event means processing finished, not a reviewed/published map.
3. **Team 2 with Team 3:** implement the exact shared packet renderer driven by pure synchronized server time; retain dark guards, 200 ms slots, pilots, exact tag and both identity passes. Capture 12-30 known phones near/middle/back using original files. Check expected IDs and orientation, then three-camera mapping and one selected ID reaching the intended channel.
4. **Captain:** review Python pins, merge this Team 3 change set, refresh shared foundation-only docs and the root test filter, then run all affected consumer gates and integrated checks. Keep the existing branch arrangement; no shared schema migration is needed for this worker fix.

Physical gate remains: stationary cameras, original codecs/timestamps/rotation, back-row visibility, motion/exposure/rolling shutter, independently counted visible phones, >=90% field recall with zero observed misidentifications, position/column usefulness, original 4K performance with review artifacts, and the full rehearsal workflow. None is inferred from synthetic or schema success.
