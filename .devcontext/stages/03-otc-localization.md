# Stage 03 - Optical localization

Status: in progress; first software slice ready for integration. Owner: Team 3 lead. Branch: feat/otc-localization. Base: foundation-v1 (ab59c27105627977ee52dc2bcd4276b4532b9e2a).

## Implemented

Frozen bounded-error packet decoding; streaming PyAV PTS/rotation; native-resolution screen detection, motion tracking and pilot-relative sampling; manual column homographies and validated overlap registration; duplicate/conflict rejection and coarse/unseen results; real process CLI with hashes/progress/atomic output; review artifacts; seeded MP4 generator, benchmark and tests.

No physical footage exists because Team 2's renderer is not built. Generated videos exercise the actual pipeline now, superseding the starter instruction to begin with a real single-screen clip. Physical acceptance remains outstanding.

## Acceptance and evidence

- Packet mathematics: all 2,048 IDs, 32,768 single-bit corrections, 245,760 double-bit rejections, bounded erasures, complemented pass, tags/membership/conflicts.
- Actual synthetic video: 24/30/60 fps, variable PTS/rotation, motion/partial cover/hidden phones/drop frames, reflections/crossings, wrong tag/empty scene, missing camera/coarse fallback, CLI and review output.
- Geometry: ordered anchors/orientation, invalid anchors, distributed overlap, held-out false match rejection, support hull and conflicting positions.
- Dense synthetic: 1,500/1,500 localized with zero incorrect positions under independent 0.015 tolerance; maximum error 0.00058544. Three 13.5-second 4K clips: 96.19 seconds and 328.66 MiB peak resident memory on AMD Ryzen 7 7840HS. The initial 90-second target remains unmet.
- Final gate passes: 64 Python tests plus shared schema/fixture/boundary/typecheck/lint/contract checks. See [evidence](../evidence/otc-localization/20260919-pipeline.md) for commands/hashes and limitations.

## Run and integrate

See [worker README](../../workers/otc/README.md) and [handoff](../teams/otc-localization/handoff.md). Run setup:python, generate clips, run process with required --evidence synthetic, then gate:otc; lint tools/otc-fixtures separately. Protocol-v1 schemas/codebook are unchanged. Captain reviews Python pins before merge.

## Remaining acceptance

1. Team 2 renders the frozen packet; record known IDs near/far with original camera files. Audit visible phones separately from participants and inspect palette, exposure, rolling shutter, screen size, motion, timestamps/rotation and HEVC/HDR.
2. Test original three-camera recordings with known seats, overlap/parallax and manual fallback. Apply the masterplan's visible-phone recall and zero-observed-misidentification targets.
3. Measure original 4K runtime/peak memory with review artifacts enabled; investigate the remaining 90-second gap without reducing correctness thresholds.
4. Team 1 integrates worker lifecycle/map commit; Team 4 integrates anchors/review. Captain updates shared foundation-only descriptions after merge.

Do not mark this stage verified before physical acceptance.
