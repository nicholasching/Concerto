# OTC worker - Team 3

Read ../../.devcontext/stages/03-otc-localization.md. From repository root: bun run setup:python then bun run gate:otc. Setup creates .venv using requirements-dev.lock and an editable package install. Schemas/codebook are read from packages/contracts/generated; preserve repository layout.

bun run otc:validate checks only the manifest boundary. bun run otc:replay explicitly replays synthetic JSON. Future processing: bun scripts/python.ts process --manifest <path> --output <path>; currently exits 2 without fabricating locations.

No MP4 or video toolchain is supplied. Pin actual codecs/dependencies, preserve identity/hash validation, and keep large captures/debug outputs under ignored runtime.
