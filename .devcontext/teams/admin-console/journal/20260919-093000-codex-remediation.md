# Admin integration-review remediation

Date / author: 2026-09-19 / Codex
Branch / baseline: `feat/admin-console` / `d5a01fa`

## Goal

Address the admin-owned defects recorded in `../../evidence/admin-console/20260919-review.md` without broadening frozen contracts or restoring the removed runtime mock harness.

## Plan and boundaries

1. Repair command scheduling, identity-based pending state, stale refresh handling, selection revision/coordinates, and per-device undo; verify with deterministic adapter and component-helper tests.
2. Repair admin-only calibration workflow state, eligibility, arm/countdown, retry persistence, and candidate-review UI where the producer boundary already supplies a schema.
3. Keep R8 (resource identities/accepted response contract) and R11 (shared synchronized-clock lifecycle) explicitly blocked on Team 1/captain. Do not invent response fields, estimator behavior, or change shared contracts.

## Baseline

- Review documents `d5a01fa` reproduce R1--R14 against prior source `30054a6`.
- `feat/admin-console` tracks `origin/feat/admin-console`; initial worktree is clean.
- Focused gate after each coherent slice: `bun run gate:admin`.

## Implemented first remediation slice

- R2/R10: adapter commands retain explicit `pending`, `accepted`, `scheduled`, `effective`, `error`, or `obsolete` state. A global revision does not confirm an unrelated command; request failures become errors; late snapshot responses cannot replace a newer response and an epoch replacement obsoletes outstanding commands.
- R3/R4/R9: canvas drawing and hit testing share one padded map transform; the selection object retains its original map revision; undo retains per-device prior channel groups.
- R1 (partial): assignment, transport, and mix commands enforce a three-second lead time. This still depends on the existing interim clock helper, so R11 remains blocked until Team 1 supplies the shared synchronized-clock lifecycle.
- R5/R14: calibration derives its participant set from authoritative eligible devices rather than fixture IDs; a later connection error stays visible even when an older snapshot exists.
- Added deterministic adapter failure and map-transform tests.

## Verification

- `bun run typecheck` and `bun test admin-frontend/tests packages/selection`: pass after implementation.
- `bun run gate:admin`: pass on this working tree (contracts/fixtures/boundaries/typecheck/lint; 14 contract and 16 admin/selection tests; production admin build).

## Remaining blockers / next action

- R6--R8/R12/R13 require the producer-owned calibration resource/result contract: frozen `CommandAccepted` does not supply a run/preparation/job identity, and the current contract offers no candidate-result retrieval route. Team 1/captain must approve that boundary before the consumer can implement prepare/ready/arm, resumable jobs, or candidate-map approval.
- R11 requires Team 1's shared `SynchronizedClock`; the interim snapshot-receipt offset is not adequate concert synchronization evidence.
- After that agreement, implement calibration persistence/retry/review and add browser-level workflow coverage; physical camera/phone evidence remains pending.
