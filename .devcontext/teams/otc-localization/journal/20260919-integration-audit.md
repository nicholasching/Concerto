# Team 3 integration readiness audit

Date: 2026-09-19. Branch: `feat/otc-localization`. Baseline: `53dd0a8` (clean working tree at audit start).

## Goal and assumptions

Verify the implemented OTC worker against `masterplan.md` and the frozen v1 producer/consumer contracts, then leave a reproducible handoff for the other teams. Software integration readiness is separate from the physical acceptance required by stage 03. No original phone recordings exist yet; Team 2's renderer is still the physical-test dependency. Other teams' implementations are not present in this checkout, so a passing boundary check cannot establish end-to-end concert behavior.

Owned scope: `workers/otc/`, `tools/otc-fixtures/`, Team 3 stage/context/evidence. Shared contracts, root scripts, other teams' implementations and BeatSync source remain their owners' files.

## Plan and checks

1. Map masterplan sections 5, 8 and 9 to code/tests and inspect identity, geometry, failure and lifecycle seams. Verify any issue with a minimal reproduction before changing implementation.
2. Run `bun run gate:otc`, fixture-tool Ruff and dependency checks; exercise the actual process CLI and validate its manifest/progress/result in the TypeScript consumer schemas.
3. Record a requirement/evidence matrix, exact integration actions and remaining physical checks. Update stage/status/handoff with the resulting readiness decision.

## Initial inspection

- The worker is implemented, while this checkout's backend remains the foundation HTTP shell. No real backend worker adapter can be exercised yet.
- Shared schemas and packet remain at frozen protocol v1. CLI adds required explicit `--evidence` and optional job/debug/worker options; these are already documented in the handoff.
- Shared foundation-only descriptions and the root contract-test substring filter are already recorded captain follow-ups. They are not changed in this Team 3 audit.

## Findings and changes

- Reproduced an actual §5.5 violation: nine shared IDs plus contradictory primary-column anchors were silently localized because overlap was inserted ahead of both independent manual maps. The new regression failed before the fix. Manual mappings now take precedence within their ROI; overlap extends coverage outside it. Agreeing views prefer a primary ROI, then decode score. Three new regressions pass; decoderVersion advances to otc-v1.2 without changing packet or wire schema.
- Added a consumer-owned-contract check in `tools/otc-fixtures/verify-handoff.ts`: generate real MP4s, invoke Python, parse actual manifest/progress/result/map using TS Zod, check independent positions/debug and hash-failure semantics. It passed 30/30 locations with max error 0.00292455.
- Fresh dense v1.2 benchmark: 1,500/1,500 correct in 30.83 s, 805.49 MiB sampled aggregate resident peak. No thresholds were changed.
- Ran the new curved auditorium clips through the real pipeline: 2,606 accepted observations cover all 1,500 IDs. An exploratory full-center comparison flagged seven partially off-frame screens; projected clipping explains the difference. Added `check_auditorium.py` to compare nearest clipped screens, own polygons and full-screen centers (unchanged 2 px tolerance for fully visible screens). No identity mismatch; 1.17645 px maximum fully visible error. Injecting two wrong IDs produces two checker failures. Ten partial-screen observations are reported separately. Null anchors yield 448 correct coarse columns and 1,052 ambiguous locations, no invented row coordinates.
- Fetched/read available remote refs: Team 1 ab59c27 (foundation), Team 2 45625bc (renderer pending), Team 4 95189af (candidate-review/API blockers). No OTC contract drift in available client/admin branches. Their code/gates were not merged or run here. Recorded Team 1/4 anchor metadata, candidate-result serving/review and publication requirements instead of implementing outside ownership.

## Verification and outcome

- Baseline `gate:otc`: 76 Python tests in 93.67 s. Final after fix: **79 tests in 85.74 s**, plus shared drift/boundary/typecheck/lint/contracts.
- `bun test ./packages/contracts/tests`: 14 unique tests / 6,171 assertions. Root filter still includes two ignored copies; captain owns correction.
- Worker + fixture-tool Ruff, `pip check`, and `git diff --check` pass.
- Raw summaries and full requirement matrix: [audit report](../../../evidence/otc-localization/20260919-integration-audit.md). Stage/status/handoff and worker/tool READMEs updated; shared files/dependencies unchanged.
- Decision: ready for software integration; no remaining Team 3 software blocker found in reviewed scope. Physical phone/camera acceptance and live backend/admin/client round trip remain pending. Next consumers run the new one-command handoff check, wire lifecycle/metadata/review, then film Team 2's exact renderer. No claim of a complete concert or field-localization gate.
