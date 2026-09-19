# otc-localization checkpoint

Status: ready for integration (first software slice; stage remains in progress). Owner: Team 3 human lead (user). Branch: feat/otc-localization. Baseline: foundation-v1, ab59c27105627977ee52dc2bcd4276b4532b9e2a.

- Implemented: actual MP4 decoding, conservative identity/tracking, manual/validated-overlap mapping, diagnostics and review artifacts. Generated clips permit independent work without phone flashing.
- Dense synthetic: 1,500/1,500 correctly positioned IDs under benchmark checks; 96.19 seconds, 328.66 MiB. Initial 90-second target remains unmet.
- Final gate passes: 64 Python tests plus shared checks. Separately verified 14 unique shared contract tests and fixture-tool lint. See [evidence](../../evidence/otc-localization/20260919-pipeline.md).
- No physical footage yet: Team 2 renderer is the next physical-test dependency. Software work is not blocked; physical optics/codec/geometry/venue performance remain unverified.
- Existing wire schemas unchanged. CLI adds required --evidence and optional --job-id/--debug-dir. Captain reviews Python dependency pins before merge.
- Next consumer action: Team 1 runs generated clips through worker lifecycle; Team 4 inspects results/review artifacts. See [handoff](handoff.md).
