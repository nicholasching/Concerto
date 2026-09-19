# sync-control checkpoint

Status: all five software slices implemented; cross-team integration and physical acceptance
pending. Owner: Team 1, Hansen Cheng.
Branch: `feat/sync-control`. Base: `foundation-v1` =
`ab59c27105627977ee52dc2bcd4276b4532b9e2a`. Nothing from this branch has been pushed by this
agent.

## Implemented

- Per-client coded-probe/minimum-RTT clock estimator with epoch invalidation, sample age and
  quality; fast WebSocket timestamp replies.
- Device IDs 0–2047, authenticated resume, one socket per identity, capacity refusal, atomic
  checkpoint and role-filtered snapshots.
- Revision-checked/idempotent show, transport, assignment and mix commands; preparation barriers,
  ready-subset delivery, pending snapshot recovery and future effective times.
- Streamed/hash-verified assets and camera recordings; calibration run/arm/discard; serialized,
  cancellable OTC process jobs; result identity checks; durable map commit and stale-map refusal.
- Immediate panic and a one-second-renewed/five-second audio lease.
- Real loopback load harness with the production estimator, join retries, snapshot recovery,
  reconnects, asset/camera uploads, CPU-active worker contention, a 1,000-device reassignment,
  in-process event-loop sampling and an evidence report.

## Verification

- `bun run gate:sync` — PASS: 185 sync-focused tests plus contracts/fixtures/boundaries,
  typecheck, lint and backend build.
- `bun test tools/load/tests` — PASS: 7 load-metric tests. Captain still needs to add this
  directory to the focused gate.
- Five-minute 1,500-client loopback evidence:
  [load-1500.md](../../evidence/sync-control/load-1500.md). The authoritative report is the run
  that names worker stage at cue time and verifies committed reassignment state.
- Detailed history:
  [clock](journal/20260919-102847-clock-estimator.md),
  [registry](journal/20260919-105418-registry-snapshots.md),
  [commands](journal/20260919-112032-scheduled-commands.md),
  [uploads/jobs/map](journal/20260919-115710-uploads-jobs-map.md),
  [panic/lease/load](journal/20260919-122123-panic-lease-load.md).

## Coordination still required

- Captain: add `tools/load/` workspace/root `test:load`/gate wiring and declare backend's direct
  `zod` dependency; these touch captain-owned root files and the lockfile.
- Contracts/Team 4: resolve proposed
  [expectedRevision semantics](../../decisions/20260919-112032-sync-control-expected-revision.md) and
  [preparation counts](../../decisions/20260919-114500-sync-control-preparation-counts.md), plus the
  missing effective master-gain and upload-receipt representations.
- Team 2: consume the estimator and enforce the audio lease through the audio output gate.
- Team 3: replace the explicitly synthetic worker fixture with the real verified OTC CLI.

## Outstanding evidence

No hardware check has passed: two-device BeatSync source baseline, real phone/browser scheduling,
acoustic timing, camera recordings/decoder correctness, venue QR/HTTPS/WSS reachability and
physical panic/lease behavior all remain. The 1,500-client run is loopback server-capacity evidence,
not a venue rehearsal.

Next action: captain review/integration, then Teams 2/3/4 consumer checks and the physical rehearsal
matrix in `masterplan.md`.
