# admin-console handoff

Read [stage brief](../../stages/04-admin-console.md), root rules/masterplan and shared schema notes before changing code.

1. Use feat/admin-console in an isolated checkout, install frozen dependencies and run `bun run gate:admin`.
2. Start a dated journal with baseline SHA, assumptions, owned files and success check.
3. Implement pure rectangle/polygon selection with orientation, unknown filtering and explicit mapRevision tests.
4. Extend meaningful tests, run the gate, update this handoff/status and pass the producer example to its consumer.

Available: Read-only synthetic map/readiness shell, selection seam and snapshot mock.
Pending: Interactive selection, command adapter, upload/review workflow and DJ timeline.
Run independently: `bun run dev:admin-demo`.
Cross-team boundary: Team 1 supplies authoritative API; Team 3 supplies reviewed optical evidence.

No unresolved software dependency prevents the first slice. Coordinate shared schema/testkit/root/lock changes with the captain. Hardware, real media/codec/network and deadline inputs are documented in masterplan section 12.

At handoff replace this starter checkpoint with exact implemented behavior, commit, commands/results, changed interfaces, blockers and next consumer action. Passing the scaffold is not feature completion.
