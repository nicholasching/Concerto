# sync-control handoff

Read [stage brief](../../stages/01-sync-control.md), root rules/masterplan and shared schema notes before changing code.

1. Use feat/sync-control in an isolated checkout, install frozen dependencies and run `bun run gate:sync`.
2. Start a dated journal with baseline SHA, assumptions, owned files and success check.
3. Extract the per-session coded probe estimator from the recorded BeatSync source paths and port its focused tests.
4. Extend meaningful tests, run the gate, update this handoff/status and pass the producer example to its consumer.

Available: Health/501 backend, epochNow/clock interfaces, fixtures and mock tests.
Pending: Production NTP lifecycle, identity/control state, uploads/jobs and socket load harness.
Run independently: `bun run dev:sync-demo`.
Cross-team boundary: Teams 2 and 4 consume clock/control; Team 3 supplies the worker boundary.

No unresolved software dependency prevents the first slice. Coordinate shared schema/testkit/root/lock changes with the captain. Hardware, real media/codec/network and deadline inputs are documented in masterplan section 12.

At handoff replace this starter checkpoint with exact implemented behavior, commit, commands/results, changed interfaces, blockers and next consumer action. Passing the scaffold is not feature completion.
