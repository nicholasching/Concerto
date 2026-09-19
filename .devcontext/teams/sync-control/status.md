# sync-control checkpoint

Status: in progress. Slices 1 and 2 of 5 implemented.
Owner: Team 1, Hansen Cheng.
Branch: feat/sync-control. Base: foundation-v1 = `ab59c27105627977ee52dc2bcd4276b4532b9e2a`.

- Owned files: backend/, packages/sync/, tools/load/
- Implemented:
  - Per-session `ClockEstimator` with injected clock, coded probe pairing, min-RTT selection,
    epoch invalidation, sample age and quality.
  - `/ws` authenticated at upgrade, answering `clock.probe` and `device.status`; one socket per
    identity, with a replaced socket closed on code 4001.
  - Device registry: IDs from 0, never recycled, capacity 2048, hashed resume tokens, atomic
    checkpoint written before a new identity is acknowledged, restore on restart under a new epoch.
  - Role-filtered snapshots over HTTP; operator access behind a shared secret with no default.
  - Global join rate limiting and coalesced operator telemetry.
- Still assigned: prepare/ready/commit barriers for calibration, assets, transport and assignment;
  scheduled execution and revisions; uploads, jobs and map commit; panic and audio lease;
  the socket load harness.
- Independent command: `bun run dev:sync-demo`. Gate: `bun run gate:sync` - passing, 67 tests.
- Evidence: [clock journal](journal/20260919-102847-clock-estimator.md),
  [registry journal](journal/20260919-105418-registry-snapshots.md).
- Physical evidence outstanding: two-device BeatSync source baseline, venue QR/HTTP/WSS
  reachability, real phone connection readiness, load. No hardware check has passed. Capacity is
  proven by allocation, not by 2,048 live sockets.
- Next action: write the slice 3 subplot (prepare/ready/commit, revisions, scheduled execution).
- Captain coordination needed: `tools/load/` is not a workspace package and cannot resolve
  `@orchestra/sync`; `zod` is used by `backend/` but not declared in its manifest.

Update this checkpoint at each handoff. Append experiment history in agent-owned journals.
