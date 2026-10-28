# Stage calibration reliability

Date: 2026-10-28 America/Toronto. Owner: integration captain.
Baseline: main 53dcdddac3ca6b566fa2dfc13449833779aec07d in isolated managed worktree, branch codex/stage-calibration-reliability. Original checkout's uncommitted lane rename and deployment notes remain untouched.

## Authorized scope / plan

User explicitly authorized: remove operator RTT gate for calibration; client maximum RTT 750 ms; server-selected future calibration timestamp; exact disabled reasons; recovered calibration ACKs; commit/push, Railway deployment and 250 simulated clients with injected latency/jitter and simultaneous music downloads.

Captain coordinates this bounded cross-team integration: contracts/schema, backend calibration/messages, admin calibration adapter/UI, sync internet profile, tests/load tooling. No parallel file owners are active; existing four-team ownership is retained and this journal is the producer/consumer handoff. BeatSync stays unchanged. Performance/transport/mix scheduling is outside this calibration-specific change.

Implementation choices: five-second start lead chosen from server time after command receipt; old timestamp field accepted optionally for compatible requests but ignored for calibration scheduling; internet uncertainty 375 ms (RTT 750 ms) with strict opt-in and freshness unchanged. Recovery replays only a current created preparation to eligible frozen participants missing ACK, preserving explicit opt-out. No synthetic IDs/locations committed as audience maps.

Checks: focused regression tests, root sync/admin/client gates, schema/fixture checks and OTC consumer checks; exact committed build verification; production 250-client scenario with seeded injected delays and real concurrent media bytes. Keep software, simulated load, browser and physical venue evidence separate. Production tests must not reset the audience or replace the user's show/media; create/discard only a test-owned calibration and use participant reads for existing assets.

## Implementation / local verification

- Server always chooses now + 5000 ms for calibration, including legacy requests containing stale timestamps. Idempotent command replay returns the original schedule without another broadcast.
- Operator start, countdown and upload-after-capture no longer depend on the operator's strict clock; the latter two use authoritative snapshot serverMs. Disabled copy names pending request, missing preparation or zero ACKs with pending/excluded counts.
- Recovery is implemented entirely in the existing server/client protocol: eligible device.status causes replay of the current created preparation if that frozen phone lacks an ACK. Current session/epoch/preparation/participant membership are validated before changing opt-out/readiness state. A sticky per-run opt-out set survives disconnect and status changes. No armed/closed preparation is resurrected.
- Internet profile accepts RTT <=750 ms; strict, 16-pair warmup, 5 ms pair filter and ten-second internet freshness are retained.
- Lane-label changes committed separately as 15bbfad and fast-forwarded into this branch before final gates.
- Root gate:sync PASS: 245 tests / 2746 assertions plus 19 contract tests, schema/fixture/boundary checks, typecheck, lint, backend build. gate:admin PASS: 31 tests / 84 assertions, same common checks and Next production build. gate:client PASS: 161 tests / 949 assertions, same common checks and Next production build. Python ruff PASS and OTC protocol consumer tests 16 PASS against the new generated schema. Latest typecheck/lint pass after load-harness additions.
- Added backend server-time, replay, stale ACK/opt-out and recovery/reconnect tests; actual rendered CalibrationPanel tested with no operator clock samples. It enables a one-phone ready subset and reports capture completion using snapshot time. No assertion was weakened to hide a failure.
- Eight-client local preflight PASS. 250-client local scenario PASS in 23.67 s: 250 ready/received/accepted, 25 readiness recoveries, five stable-identity reconnects, zero errors, 3002 verified fixture-tone downloads / 768644088 bytes, max concurrency 250, 177 downloads active when arm response arrived. Cue margin p50 4699 ms. Evidence ignored runtime/stage-local-load-250.json and .log. Script uses actual ClockSync and CalibrationSession with seeded ordered delay/jitter/spikes; it does not model independent venue radios or physical sound/cameras.
- The live preflight read found a stopped placeholder show with no music and an unfinished created calibration. Deployment resets unfinished runs by design; no existing run was armed/discarded for this preflight. Production test will create only its own new run after redeployment, preserve the show and disconnect its test clients.

Status: source checks complete; production deployment/load verification follows. Physical venue rehearsal remains required.
