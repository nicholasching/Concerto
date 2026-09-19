# sync-control checkpoint

Status: in progress. Slices 1, 2 and 3 of 5 implemented.
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
  - Revision-checked idempotent operator commands; show save with durable persistence.
  - Preparation barriers and scheduled transport cues with a minimum lead time; the operator, not a
    timeout, decides when a cue fires, and the ready subset is what runs.
  - Scheduled assignments with server-owned channel membership, and scheduled mix.
- Still assigned: calibration barriers; uploads, jobs and map commit; panic and audio lease;
  the socket load harness.
- Independent command: `bun run dev:sync-demo`. Gate: `bun run gate:sync` - passing, 113 tests.
- Evidence: [clock journal](journal/20260919-102847-clock-estimator.md),
  [registry journal](journal/20260919-105418-registry-snapshots.md),
  [commands journal](journal/20260919-112032-scheduled-commands.md).
- Open contract decisions: [expectedRevision semantics](../../decisions/20260919-112032-sync-control-expected-revision.md)
  and [preparation counts](../../decisions/20260919-114500-sync-control-preparation-counts.md),
  both proposed and awaiting the captain and Team 4.
- Physical evidence outstanding: two-device BeatSync source baseline, venue QR/HTTP/WSS
  reachability, real phone connection readiness, load. No hardware check has passed. Capacity is
  proven by allocation, not by 2,048 live sockets.
- Next action: write the slice 4 subplot (streamed uploads, job adapter, map commit).
- Captain coordination needed: `tools/load/` is not a workspace package and cannot resolve
  `@orchestra/sync`; `zod` is used by `backend/` but not declared in its manifest.

Update this checkpoint at each handoff. Append experiment history in agent-owned journals.
