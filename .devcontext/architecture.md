# Architecture checkpoint

Status: integrated local software on main; physical acceptance pending. Baseline: four feature branches merged through 5eb08ab plus captain integration.

## Implemented integration

- Bun/Hono owns identity, domain revisions, prepared future cues, per-device routing, streamed media, job isolation and durable checkpoints. Operator HTTP and WebSocket credentials are separate from participant resume tokens.
- Both Next browsers use the shared ClockSync/ClockEstimator; snapshots are state, never a clock estimator. Audio unlock/hash verification and foreground readiness gate prepared playback. Effective mix and pending actions recover on reconnect; routine snapshots do not restart sources.
- The operator edits prepared clips/cues, views waveforms, runs calibration, specifies camera geometry, reviews actual worker artifacts, commits maps and assigns explicit ID sets. Manual columns are coarse/null-coordinate locations.
- Python OTC receives an immutable manifest and produces candidate results. Job identity, input hashes and unchanged geometry are checked before commit. Worker cancellation stops the process tree. Generated recordings remain synthetic evidence.
- Restart preserves ID allocation, hashed resume credentials, saved show/map/routing and next calibration tag. It creates a new clock epoch and stops playback. Pending runtime jobs/runs are not resumed; operators repeat capture after a restart.
- Local dev defaults and tests are documented in root README. Railway deployment is explicitly deferred by the user.

## Historical foundation inventory

| Boundary | Implemented now | Assigned next |
| --- | --- | --- |
| backend | Bun/Hono health and typed 501 responses | Team 1: identity, clock replies, state, scheduled control, uploads/jobs |
| client-frontend | Next shell, development readiness fixture | Team 2: join/unlock, audio, flashes, reconnect |
| admin-frontend | Next shell, development 1,500-device map/counts | Team 4: upload/review, selection, assignments, timeline |
| packages/contracts | Zod models, generated JSON Schema, encoder/codebook/vectors | Captain: coordinated boundary changes |
| packages/sync | Attributed epochNow and clock interfaces | Team 1: estimator/probe lifecycle |
| packages/audio | Injected-clock interface only | Team 2: AudioContext/buffer/output scheduling |
| packages/selection | Selection interface only | Team 4: pure geometry |
| packages/testkit | Crowds/FakeClock and labeled loopback snapshot/assets/probe/broadcast mock | Captain: shared fixes; team scenarios in tools/*-demo |
| workers/otc | Python validation, explicit synthetic replay; process fails | Team 3: video toolchain, tracking/decoding/geometry |
| fixtures | Original tones and synthetic JSON, no MP4s | Team 3: new optical fixtures; captain: shared goldens |
| beatsync-source | Unchanged reference outside active workspaces | Selective extraction with provenance |

## Invariants

1. Scheduling uses future server time, epoch and explicit units; receipt time is not execution time.
2. Optical timing uses pure clock offset. Output compensation stays in audio.
3. Public IDs 0..2047 are not credentials. Identity, revisions and resume are server-owned.
4. Unknown/coarse/ambiguous locations have null coordinates; synthetic evidence is labeled.
5. WebSockets carry control; HTTP assets carry audio; uploads carry original footage.
6. Video work runs in a separate process.
7. Pending transport, assignment and mix have independent cancellation domains.
8. Schemas do not replace semantic or authentication checks.
9. Production routes never silently replay fixture success.
10. CalibrationPlan precedes recording; CalibrationRun adds start; completed uploads create CalibrationManifest.

Masterplan describes intended features. Update this checkpoint when implementations land, linking evidence.
