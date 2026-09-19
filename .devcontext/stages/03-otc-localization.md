# Stage 03 - Optical localization

Integrated-main checkpoint, 2026-09-19: v1.4 passes 90 Python tests and decodes the two visible devices (9 and 11) in the original physical sample through the live console. See the [physical investigation](../teams/otc-localization/journal/20260919-two-physical-screens.md). Both results are column-only without anchors; authoritative commit and broader near/far/three-camera/venue acceptance remain separate. The initial branch checkpoints below are historical.

Status: in progress; software implementation audited and ready for integration. Owner: Team 3 lead. Branch: feat/otc-localization. Base: foundation-v1 (ab59c27105627977ee52dc2bcd4276b4532b9e2a).

## Implemented

Frozen bounded-error packet decoding; streaming PyAV PTS/rotation; native-resolution screen detection, motion tracking and pilot-relative sampling; manual column homographies and validated overlap registration; duplicate/conflict rejection and coarse/unseen results; real process CLI with hashes/progress/atomic output; review artifacts; seeded MP4 generator, benchmark and tests. Default processing uses one spawned process per camera; serial reference remains available. Perspective fixtures exercise variable native screen sizes and compressed distant rows.

No physical footage exists because Team 2's renderer is not built. Generated videos exercise the actual pipeline now, superseding the starter instruction to begin with a real single-screen clip. Physical acceptance remains outstanding.

## Acceptance and evidence

- Packet mathematics: all 2,048 IDs, 32,768 single-bit corrections, 245,760 double-bit rejections, bounded erasures, complemented pass, tags/membership/conflicts.
- Actual synthetic video: 24/30/60 fps, variable PTS/rotation, motion/partial cover/hidden phones/drop frames, reflections/crossings, wrong tag/empty scene, missing camera/coarse fallback, CLI and review output.
- Geometry: ordered anchors/orientation, invalid anchors, distributed overlap, held-out false match rejection, support hull and conflicting positions.
- Dense synthetic: same 1,500/1,500 correct positions in serial/parallel modes, maximum error 0.00058544. Fresh three-clip 4K comparison: 97.80 seconds serial vs 32.19 parallel; sampled aggregate resident memory 292.90 vs 801.14 MiB. Initial 90-second target met on synthetic inputs.
- Perspective review: 90/90 localized across front/middle/back; largest front screen 37x59 and smallest rear 12x18 pixels. Automated smaller-image scenarios include six-pixel rear screens and safe rejection of deliberate 1x2-pixel phones.
- Latest [integration audit](../evidence/otc-localization/20260919-integration-audit.md): corrected overlap precedence so contradictory primary anchors remain ambiguous; agreeing views prefer the primary ROI. Final gate: **79 Python tests** plus shared schema/fixture/boundary/typecheck/lint/contracts. Real CLI output/progress also passes the consumer TypeScript schemas and an injected hash-failure check.
- Fresh decoder v1.2 dense run: all 1,500 localized correctly in 30.83 seconds; sampled aggregate resident peak 805.49 MiB. Curved/tiered fixture: all 1,500 IDs recovered, but null anchors intentionally produce 448 coarse / 1,052 ambiguous locations. No full seat map or physical recall is claimed. See [scene evidence](../evidence/otc-localization/20260919-auditorium-sweep.md), [parallel/perspective evidence](../evidence/otc-localization/20260919-parallel-perspective.md) and [initial evidence](../evidence/otc-localization/20260919-pipeline.md) for prior checks.

## Run and integrate

See [worker README](../../workers/otc/README.md) and [handoff](../teams/otc-localization/handoff.md). Run setup:python, generate clips, run process with required --evidence synthetic, then gate:otc; lint tools/otc-fixtures separately. Protocol-v1 schemas/codebook are unchanged. Captain reviews Python pins before merge.

Consumer proof: `bun tools/otc-fixtures/verify-handoff.ts` generates fresh clips and validates the actual worker boundary from TypeScript. Team 1 still owns lifecycle/current-state publication; Teams 1/4 must connect camera geometry metadata and candidate review before map commit. No other branch was merged or live application integration claimed in this audit.

## Remaining acceptance

1. Team 2 renders the frozen packet; record known IDs near/far with original camera files. Audit visible phones separately from participants and inspect palette, exposure, rolling shutter, screen size, motion, timestamps/rotation and HEVC/HDR.
2. Test original three-camera recordings with known seats, overlap/parallax and manual fallback. Apply the masterplan's visible-phone recall and zero-observed-misidentification targets.
3. Measure original 4K runtime/aggregate memory with review artifacts enabled; the clean synthetic 90-second target is met, but original-camera throughput remains unverified.
4. Team 1 integrates worker lifecycle/map commit; Team 4 integrates anchors/review. Captain updates shared foundation-only descriptions after merge.

Do not mark this stage verified before physical acceptance.
