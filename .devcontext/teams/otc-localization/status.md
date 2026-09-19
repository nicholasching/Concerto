# otc-localization checkpoint

Status: not started (foundation available).
Owner: Team 3 human lead, to be named.
Branch: feat/otc-localization. Base: foundation-v1; record resolved SHA in first journal.

- Owned files: workers/otc/, tools/otc-fixtures/
- Implemented foundation: Python schema/identity validation, explicit synthetic replay and complete codebook.
- Assigned feature work: MP4 fixtures, video dependencies, real process decoder, tracking and registration.
- Independent command: `bun run otc:validate; bun run otc:replay`.
- Gate: `bun run gate:otc` after `bun run setup:python`.
- Foundation evidence: [verification](../../evidence/foundation/verification.md). No feature/hardware gate has passed yet.
- Next action: Implement an independent bounded-error codeword decoder and tests, while obtaining an actual near/back-row camera sample.
- Dependencies: Team 1 consumes CLI/results; Team 4 consumes review evidence; Team 2 supplies physical packet clips. Frozen fixtures permit work now.

Update this checkpoint at each handoff. Append experiment history in agent-owned journals.
