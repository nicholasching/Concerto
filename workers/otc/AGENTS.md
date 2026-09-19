# Team 3 ownership

Follow root AGENTS.md and rules.md. This directory belongs to feat/otc-localization; read .devcontext/stages/03-otc-localization.md and that team's status/handoff from repository root. Maintain agent journals continuously in .devcontext/teams/otc-localization/journal/.

Current implementation: frozen packet decoder, PTS-based video tracking/sampling, manual/validated-overlap geometry, real process CLI, debug artifacts and generated MP4 tests. See README and Team 3 evidence for exact checks and remaining physical validation. Do not replace the real pipeline with fixture replay or weaken identity acceptance to improve recall.

Verify with `bun run gate:otc` from repository root; separately lint tools/otc-fixtures. Shared contracts/testkit/root scripts/lockfiles belong to the integration captain; this team's Python dependency pins require captain review before merging. Keep BeatSync reference code unchanged and never import it at runtime.
