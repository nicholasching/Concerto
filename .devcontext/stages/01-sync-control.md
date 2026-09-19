# Stage 01 - Sync and authoritative control

Status: not started (foundation provided). Owner: Team 1 lead, default captain. Branch: feat/sync-control. Base: foundation-v1.

## Agent assignment

> Implement Team 1 from masterplan sections 4, 6 and 8. Read rules, context, schemas and provenance first. Own backend/, packages/sync/ and tools/load/. Extract only required BeatSync behavior with attribution. Start with a tested per-session estimator and timestamp reply path, then identity/snapshots, subscriptions and scheduled state. Keep journals/status/handoff current and extend your gate. Never report simulated timing as physical audio evidence.

## Available and runnable

Health/foundation-info and typed 501 routes; epochNow/clock interfaces; golden schemas; FakeClock and mock snapshot/media/probe tests. No production sockets, identity/state, jobs or load implementation.

Run `bun run dev:sync-demo` (8080); verify `bun run gate:sync`.

## Ordered slices and acceptance

1. Port estimator tests into per-session code with injected clock. Verify offset sign, minimum RTT, coded pair rejection/reset, sample age, wall-clock changes and server epoch replacement. Characterize the source two-device path with Team 2.
2. Registry/snapshots: IDs including 0, authenticated resume, capacity 2048, concurrent socket rule, durable checkpoint/new-epoch restart, role filtering. Reproduce duplicate/reconnect/spoof failures.
3. Assignments/assets/calibration/transport/mix: preparation ACK identity, revisions/idempotency, effective versus pending state and future execution. Test stale ACK/revision, lost broadcast/resnapshot, slow clients and channel isolation.
4. Streamed assets/uploads/jobs/map commit: hash files, invoke worker without shell, isolate CPU, validate result identity before commit. Inject a fake worker initially; replace with Team 3 CLI.
5. Panic/audio lease and real tools/load scenario: 1,500 sockets for five minutes with upload/job contention; report cue/event-loop latency and exclusions.

Use simulated clients in tools/load for independent behavior, never another team's unmerged UI or fake production success.

## Captain and handoff

Captain coordinates root lock/config/scripts/CI, shared contracts/testkit and merge order. Send consumers schemas/examples/error cases and a passing command for each slice. Team 3 supplies CLI; Teams 2/4 consume control. Keep shared context/integration stage current. Feature completion includes source/two-phone and venue reachability evidence beyond the current gate.
