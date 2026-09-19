# otc-localization checkpoint

Status: ready for integration (first software slice; stage remains in progress). Owner: Team 3 human lead (user). Branch: feat/otc-localization. Baseline: foundation-v1, ab59c27105627977ee52dc2bcd4276b4532b9e2a.

- Implemented: actual MP4 decoding, conservative identity/tracking, manual/validated-overlap mapping, diagnostics and review artifacts. Default is one spawned process per camera; --workers 1 keeps a serial reference.
- New same-input dense synthetic comparison: 1,500/1,500 correct in both modes; 97.80 seconds serial vs 32.19 seconds parallel (~3x). Sampled aggregate memory: 292.90 vs 801.14 MiB. The 90-second target is met on the clean synthetic set; original venue footage is still untested.
- Perspective fixtures: larger foreground and smaller back-row screens, converging rows; 90/90 review phones localized. Explicit 1x2-pixel rear phones stay unseen. No acceptance threshold was loosened.
- New viewing fixture: 1,500 phones in 30 curved/rising rows with two aisle gaps; 4K overview and three close views in runtime/otc-fixtures/auditorium-1500. All phones fit in the overview; this is synthetic media, not a 1,500-phone localization result. See [scene evidence](../../evidence/otc-localization/20260919-auditorium-sweep.md).
- Final gate passes: 76 Python tests plus shared checks; fixture-tool Ruff and whitespace checks pass. See [new scene evidence](../../evidence/otc-localization/20260919-auditorium-sweep.md), [parallel/perspective evidence](../../evidence/otc-localization/20260919-parallel-perspective.md) and [initial evidence](../../evidence/otc-localization/20260919-pipeline.md).
- No physical footage yet: Team 2 renderer is the next physical-test dependency. Software work is not blocked; physical optics/codec/geometry/venue performance remain unverified.
- Existing wire schemas unchanged (decoderVersion otc-v1.1). CLI supports --evidence, --job-id/--debug-dir and --workers 1|3 (default 3). Forced cancellation must stop the process tree. Captain reviews previously added Python pins before merge; this slice adds no dependencies.
- Next consumer action: Team 1 runs generated clips through worker lifecycle; Team 4 inspects results/review artifacts. See [handoff](handoff.md).
