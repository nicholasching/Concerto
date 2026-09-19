# Stage 03 - Optical localization

Status: not started (CLI boundary provided). Owner: Team 3 lead. Branch: feat/otc-localization. Base: foundation-v1.

## Agent assignment

> Implement Team 3 from masterplan sections 5 and 8. Own workers/otc/ and tools/otc-fixtures/. Consume generated codebook/JSON Schema, reject uncertain IDs, and keep video work in the separate worker. Begin with independent decoder mathematics and a real single-screen clip, then tracking/manual column geometry, then overlap registration. Record ground truth, rejection reasons, timing and handoffs continuously.

## Available and runnable

Python manifest/result validation, synthetic replay, process command that deliberately fails, 2,048 codewords/goldens and synthetic JSON observations. **No MP4 fixtures, decoder, OpenCV, PyAV or FFmpeg are supplied.** Placeholder paths/hashes are not evidence.

Run `bun run setup:python`, `bun run otc:validate`, `bun run otc:replay`; verify `bun run gate:otc`. Future real CLI: `bun scripts/python.ts process --manifest <manifest.json> --output <result.json>`.

## Ordered slices and acceptance

1. Independent codebook decoder: every ID, all single-bit correction/double-bit rejection under stated assumptions, bounded erasures, complemented pass, wrong tags and conflicts. Coordinate dependency pins with captain.
2. Obtain original near/back-row camera clips immediately. Pin toolchain; use actual PTS/rotation. Prove one screen's pilots/preamble/phase/interior sampling before scaling.
3. Seeded video generator with independent ground truth in tools/otc-fixtures: motion, occlusion, tiny screens, transition mixing, variable timing, compression/color shifts, merged tracks, reflections and distractors. Never derive truth from decoder output.
4. Stream native-resolution ROIs, track motion, preserve erasures/reject crossings, export per-observation/debug evidence and validated result identity.
5. Manual primary-column anchors/orientation first. Overlap needs distributed matches/inliers/held-out residuals; missing cameras or parallax retain manual/coarse fallback.
6. Three original 4K clips on named laptop: audited visible-phone recall/false accepts, column correctness, runtime/peak memory. Apply masterplan targets and report limits.

## CLI and handoff

Preserve validation and explicit synthetic replay. Real process stdout carries structured progress, stderr diagnostics; nonzero exits cannot count as success. Validate files/hashes and output schema. Backend owns timeout/cancellation and authoritative map commit.

Give Team 1 CLI/result/progress/failure examples and Team 4 camera-space review/geometry evidence. Supply one tiny reproducible clip, invocation, manifest hashes and expected output. Keep large/real crowd clips in ignored runtime, with context manifests. Begin independent fixtures while Team 2 develops rendering.
