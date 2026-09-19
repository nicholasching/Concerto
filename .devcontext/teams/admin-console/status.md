# admin-console checkpoint

Status: ready for integration (real-server wired; no live data until Team 1 ships the server).
Owner: Team 4 human lead, to be named.
Branch: feat/admin-console. Base: foundation-v1 (ab59c27).

- Owned files: admin-frontend/, packages/selection/, tools/admin-demo/
- Implemented: pure selection geometry; typed adapter (the only server interface); interactive
  console UI (Session, Calibration, Review, Assign, Perform). Calibration takes a real video file.
- Fake-input harness: REMOVED per user direction. The console now talks to the real control server
  (port 8080, Team 1) only. When the real server is not running, every action attempts the real
  call and shows a clean "Real server not detected" error in its catch block — nothing is faked.
- Still proposed or unfinished: live data (needs Team 1 real server); OTC decode of uploaded
  video (needs Team 3 worker); shared-clock swap to @orchestra/sync estimator; lasso/freehand
  selection (rectangle only for now).
- Independent command: `bun run dev:admin-demo` (console 3001, pointed at real server 8080).
- Gate: `bun run gate:admin` — passes (typecheck, lint, contract checks, 13 admin tests, build).
- Evidence: adapter tests verify the not-detected path against a dead port; selection tests cover
  geometry/orientation/1500-point cost. No live-data or physical evidence yet (by design).
- Next action: integrate with Team 1's real server behind the adapter; swap clock helper to
  SynchronizedClock when Team 1 ships the estimator; add lasso selection if operators need it.
- Dependencies: Team 1 supplies authoritative API (port 8080); Team 3 supplies OTC decode.
  Changes needing captain review before merge: root `scripts/dev.ts` (admin-demo no longer spawns a
  harness, console points at 8080) and `bun.lock` (admin-frontend -> @orchestra/selection).

Update this checkpoint at each handoff. Append experiment history in agent-owned journals.
