# admin-console checkpoint

Status: ready for integration (mock-verified; physical/producer evidence outstanding).
Owner: Team 4 human lead, to be named.
Branch: feat/admin-console. Base: foundation-v1 (ab59c27).

- Owned files: admin-frontend/, packages/selection/, tools/admin-demo/
- Implemented: pure selection geometry; typed adapter; fake-input harness with calibration/assignment/
  transport/mix/panic/job routes; interactive console UI (Session, Calibration, Review, Assign,
  Perform); automated operator walkthrough test.
- Still proposed or unfinished: real-server adapter wiring (drop-in, not built); shared-clock swap
  to @orchestra/sync estimator when Team 1 delivers it; lasso/freehand selection (rectangle only
  for now); physical walkthrough with real phones/cameras (producer-owned).
- Independent command: `bun run dev:admin-demo` (console 3001, harness 18084).
- Gate: `bun run gate:admin` — passes (typecheck, lint, contract checks, 8 admin tests, build).
- Evidence: walkthrough test (`admin-frontend/tests/walkthrough.test.ts`) drives uploads -> commit
  map -> assignment -> play -> stop -> panic end to end against the harness, plus stale-map
  rejection. This is mock evidence; it does not establish real-phone, real-camera, or venue behavior.
- Next action: integrate with Team 1's real server behind the adapter; swap the clock helper to
  SynchronizedClock when Team 1 ships the estimator; add lasso selection if operators need it.
- Dependencies: Team 1 supplies authoritative API; Team 3 supplies reviewed optical evidence.
  Lockfile changed (admin-frontend -> @orchestra/selection) — captain review required before merge.

Update this checkpoint at each handoff. Append experiment history in agent-owned journals.
