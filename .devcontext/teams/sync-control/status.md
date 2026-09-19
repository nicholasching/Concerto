# sync-control checkpoint

Status: in progress. Slice 1 of 5 implemented (clock estimator and server timestamp reply path).
Owner: Team 1, Hansen Cheng.
Branch: feat/sync-control. Base: foundation-v1 = `ab59c27105627977ee52dc2bcd4276b4532b9e2a`.

- Owned files: backend/, packages/sync/, tools/load/
- Implemented: per-session `ClockEstimator` with injected clock, coded probe pairing, min-RTT
  offset selection, epoch invalidation, sample age and quality; `/ws` endpoint answering
  `clock.probe` with `clock.reply`; structured errors for malformed, wrong-session and
  not-yet-served messages.
- Still assigned: identity registry and resume, role-filtered snapshots, subscriptions,
  prepare/ready/commit for calibration/assets/transport/assignment, uploads and jobs, map commit,
  checkpoint recovery, panic and audio lease, socket load harness.
- Independent command: `bun run dev:sync-demo`.
- Gate: `bun run gate:sync` - passing as of the slice 1 commit.
- Evidence: [journal](journal/20260919-102847-clock-estimator.md), foundation
  [verification](../../evidence/foundation/verification.md).
- Physical evidence outstanding: two-device BeatSync source baseline, venue QR/HTTP/WSS
  reachability, real phone connection readiness. No hardware check has passed.
- Next action: write the slice 2 subplot (registry, resume, capacity, role-filtered snapshots),
  then implement it.
- Dependencies: Teams 2 and 4 consume the clock and control surface; Team 3 supplies the worker
  boundary. Nothing blocks slice 2.

Update this checkpoint at each handoff. Append experiment history in agent-owned journals.
