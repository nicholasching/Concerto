# admin-console checkpoint

Status: in progress (review remediation; producer contract blockers remain).
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
- Review remediation: selection retains its captured map revision; canvas hit testing uses the
  same padded transform as drawing; per-device undo is preserved; command failures are explicit
  and unrelated revisions cannot confirm them; commands use a minimum three-second lead; and
  calibration chooses eligible authoritative devices instead of IDs 0--29.
- Still blocked: calibration prepare/ready/arm, resource identities, retry/resume and candidate
  review need Team 1/captain to define the successful calibration/job result boundary. The local
  snapshot-receipt clock helper is not a synchronized-clock implementation.
- Independent command: `bun run dev:admin-demo` (console 3001, pointed at real server 8080).
- Gate: `bun run gate:admin` — passes (typecheck, lint, contract checks, 13 admin tests, build).
- Evidence: adapter tests verify the not-detected path against a dead port; selection tests cover
  geometry/orientation/1500-point cost. No live-data or physical evidence yet (by design).
- Next action: Team 1/captain agrees the calibration/job resource and candidate-result contract;
  then implement prepare/ready/arm, candidate review and retry against that approved boundary.
- Dependencies: Team 1 supplies authoritative API (port 8080); Team 3 supplies OTC decode.
  Changes needing captain review before merge: root `scripts/dev.ts` (admin-demo no longer spawns a
  harness, console points at 8080) and `bun.lock` (admin-frontend -> @orchestra/selection).

Update this checkpoint at each handoff. Append experiment history in agent-owned journals.
