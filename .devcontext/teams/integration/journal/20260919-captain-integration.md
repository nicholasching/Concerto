# Captain integration — 2026-09-19

Status: verified for local software. User assigned review/fixes of Teams 1/2, merge of all four feature branches into main, and integrated functionality; subsequently clarified local operation first and Railway later. The initial plan below records the starting scope, superseded by that clarification.

## Baseline and ownership

- Main/foundation-v1: ab59c27105627977ee52dc2bcd4276b4532b9e2a, clean at start.
- Pulled sync-control to 0ae3487 and audio-client to e91075b with fast-forward-only pulls in separate worktrees.
- OTC local/remote: 17299a1; admin local/remote: 82cd86f. Admin worktree contains an existing untracked journal, preserved without modification.
- Captain owns shared interfaces/root/deployment and, under this user request, cross-team review fixes. Keep branch-specific fixes on their branch before integration where possible. Never modify beatsync-source.

## Plan and success criteria

1. Inspect each branch's implementation/handoff and run focused gates from its worktree root. Reproduce and fix concrete Team 1/2 defects.
2. Merge all four branches into main without rewriting their history. Resolve documented interface proposals and producer/consumer mismatches coherently; regenerate schema/fixture artifacts together.
3. Complete real join/sync/readiness/calibration/upload/worker/review/map/assignment/playback/mix/panic/recovery paths and Railway configuration.
4. Verify focused gates, real HTTP/WebSocket integration, browser operator/participant flows, worker processing, source isolation, and deployment startup. Record synthetic/load/browser/physical evidence separately.

## Assumptions and limits

- Tasks #1/#2 mean the sync-control and audio-client teams in masterplan.
- Railway target is one authoritative control process with durable volume, separate worker subprocess, HTTPS/WSS, and the two frontends. Investigate the simplest supported packaging before implementing deployment.
- No venue phones/cameras/stems were supplied with this request. Complete testable software; do not mark physical acceptance complete without recorded evidence.
- Actual public deployment or publication credentials are not assumed. Produce runnable, reviewable deployment artifacts and verify locally as far as available tooling permits.

## Initial findings

- Team 1 and Team 2 have incompatible WebSocket authentication parameter names (resumeToken vs token).
- Team 1 owns a real estimator; Team 2 handoff still uses a development fixture clock pending integration.
- Proposed shared decisions include domain expectedRevision, preparation counts, effective mix recovery, and participant manual-column fallback. These are integration work, not completed features.

## Verification log

- git status/worktree/branch inspection and git fetch origin --tags complete. All four feature tips identified; existing admin untracked work preserved.

## Integration checkpoint

- User clarified local functionality first; defer Railway deployment until the local project is reviewed. No cloud project or demo stems exist yet.
- Reviewed sync fixes committed a35ce11 (188 focused tests plus contracts), audio fixes b71425a (110 focused tests plus contracts). All four branches merged on main through 5eb08ab; no history rewritten and no remote push performed.
- Accepted captain ADR 20260919-140000-integration-boundaries: additive operator preparation/run/job state, effective mix recovery, domain revisions, separate operator credentials, participant manual columns, one shared clock lifecycle.
- Wired real backend/operator/participant flow, show upload/editor, QR, calibration prep/arm, camera geometry/upload, real Python subprocess with full CLI arguments, candidate preview/commit, manual column selection and lasso.
- `bun run typecheck` passed after annotating the seed script's track list. Combined backend/client/audio/sync/admin/selection test run passed 311 tests before subsequent hardening.
- Started `bun run dev:all` and seeded four original eight-second tones via `bun run demo:seed`. Operator login works in Chromium. Browser inspection exposed `Illegal invocation` from passing native setTimeout as an object method; corrected the shared lifecycle with an explicit wrapper. Browser retest in progress.
- Tightening live assignment prepare/ready/commit (silent durable routing remains valid before playback), per-domain snapshot reconciliation without audio reloads, scheduled gain supersession, and immutable worker input validation at map commit. Focused regressions and real HTTP/WS/video E2E are next; physical phone/camera/acoustic acceptance is still unverified.

## Final implementation and experiments

- Completed the real flows listed at the checkpoint, including live assignment preparation, precise revision scopes, telemetry-safe playback reconciliation, timed gain replacement, durable panic cancellation, job input/evidence/geometry validation, run-tag persistence, bounded streamed uploads, subprocess cancellation, waveform/cue editor, review filters and explicit calibration capture reports. Late interrupted-pattern reports now invalidate candidates that included that phone.
- Browser testing caught the native timer receiver error, startup audio mapping slightly below zero, and stale scaffold status text. Real streaming HTTP exposed Bun's request reader lacking releaseLock although the unit stream provided it. Fixed each observed failure and retained regression/browser checks. Operator and participant now both use the actual shared clock.
- Initial load checks revealed weaknesses hidden by unconditional simulated ready ACKs. Updated the simulator to require measured clock readiness and to use production ClockSync. A subsequent test isolated stale readiness after a rejected steady-state pair; added prompt retries without changing estimator thresholds and a deterministic regression. Retained the failed 500/1500 run and documented the 328/1000 assignment failure; final 1500/300s run passes all delivery/assignment/reconnect/worker checks with p99 control lag 41.5 ms.
- Final `gate`: 345 JS tests, 79 Python tests, contracts/fixtures/boundaries/type/lint and three builds pass. Production HTTP smoke and real HTTP/WS/Python E2E pass. Source-free install/full gate pass; refreshed final sources pass focused JS/build/E2E/startup checks. Final timeline alignment correction passes the admin gate and startup in the isolated copy, plus visual QA.
- Desktop browser confirms real join/resume, audio unlock/decode (4/4), coarse manual fallback, future assignment/playback, panic, calibration completion (1 finished/0 interrupted), stopped restart, review evidence filters and aligned waveforms/ruler. No acoustic or optical field measurement claimed.
- Local app left running on 3000/3001/8080 with original test tones. Team 1/2 worktrees are clean after moving only the captain's own review logs into ignored runtime; the admin's existing untracked journal remains untouched. No remote push, Railway action, destructive reset or BeatSync edit.
- Handoff: user local review, then actual stems, phone/camera/venue measurements, Railway configuration and three complete physical rehearsals. See [verification](../../../evidence/integration/verification.md) and [handoff](../handoff.md).
