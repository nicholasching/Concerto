# audio-client handoff

Read [stage brief](../../stages/02-audio-client.md), root rules/masterplan and shared schema notes before changing code.

1. Use feat/audio-client in an isolated checkout, install frozen dependencies and run `bun run gate:client`.
2. Start a dated journal with baseline SHA, assumptions, owned files and success check.
3. Implement one AudioContext unlock/preload/scheduled click against an injected clock and the original tone fixture.
4. Extend meaningful tests, run the gate, update this handoff/status and pass the producer example to its consumer.

Available: Participant readiness shell, AudioEngine seam, packet goldens and mock assets/probes.
Pending: Actual join/resume, audio scheduling, flash renderer and mobile lifecycle.
Run independently: `bun run dev:client-demo`.
Cross-team boundary: Team 1 owns sync/state; Team 3 consumes rendered packets; Team 4 consumes readiness.

No unresolved software dependency prevents the first slice. Coordinate shared schema/testkit/root/lock changes with the captain. Hardware, real media/codec/network and deadline inputs are documented in masterplan section 12.

At handoff replace this starter checkpoint with exact implemented behavior, commit, commands/results, changed interfaces, blockers and next consumer action. Passing the scaffold is not feature completion.
