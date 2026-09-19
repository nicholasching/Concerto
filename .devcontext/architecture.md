# Architecture checkpoint

Status: foundation implemented; concert behavior pending. Baseline: foundation-v1.

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
