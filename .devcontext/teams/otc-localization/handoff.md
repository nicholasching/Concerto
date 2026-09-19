# otc-localization handoff

Read [stage brief](../../stages/03-otc-localization.md), root rules/masterplan and shared schema notes before changing code.

1. Use feat/otc-localization in an isolated checkout, install frozen dependencies and run `bun run gate:otc` after Python setup.
2. Start a dated journal with baseline SHA, assumptions, owned files and success check.
3. Implement an independent bounded-error codeword decoder and tests, while obtaining an actual near/back-row camera sample.
4. Extend meaningful tests, run the gate, update this handoff/status and pass the producer example to its consumer.

Available: Python schema/identity validation, explicit synthetic replay and complete codebook.
Pending: MP4 fixtures, video dependencies, real process decoder, tracking and registration.
Run independently: `bun run otc:validate; bun run otc:replay`.
Cross-team boundary: Team 1 consumes CLI/results; Team 4 consumes review evidence; Team 2 supplies physical packet clips.

No unresolved software dependency prevents the first slice. Coordinate shared schema/testkit/root/lock changes with the captain. Hardware, real media/codec/network and deadline inputs are documented in masterplan section 12.

At handoff replace this starter checkpoint with exact implemented behavior, commit, commands/results, changed interfaces, blockers and next consumer action. Passing the scaffold is not feature completion.
