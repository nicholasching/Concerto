# Parallel processing and perspective fixture session

Status: ready for integration; physical validation remains pending. Team 3, feat/otc-localization. Baseline: 49328c3.

## Scope, assumptions and verification

User requests three camera worker processes and perspective-varying phone screen sizes in fixtures. The provided auditorium image is a visual reference, not calibrated camera/seat geometry or instructions. Camera stabilization is not part of this change; stationary-camera assumptions remain.

1. Spawn one independent process per camera, at most three; preserve sequential frame tracking inside each worker and merge in manifest order -> verify serial/parallel equivalence, separate worker PIDs, monotonic progress and cleanup on failures.
2. Add perspective/depth fixtures with independently authored positions and screen footprints, including resolvable near/back phones and explicit below-resolution phones -> verify correctness by depth/size and safe unknown results, publish viewable generated clips under runtime.
3. Benchmark old clean 1,500-ID 4K inputs and perspective inputs, measuring actual aggregate worker memory -> record runtime/accuracy and comparison limitations, run gate:otc, update handoff/evidence and commit.

Parent owns worker orchestration/CLI, integration and shared Team 3 context. Parallel agents have disjoint assignments: perspective generator/tests/tool README; multiprocessing tests; benchmark memory accounting. No shared/root/schema/dependency changes are planned. Per-worker OpenCV remains one thread and codec decode two to avoid oversubscribing the machine. A workers=1 reference mode supports correctness/performance comparisons.

## Implementation and measured progress

- Extracted camera processing into a spawn-safe module, bounded to three manifest cameras. Dedicated one-way pipes carry compact observations/progress; large frames/track histories stay in the child, with disjoint debug files. Parent alone emits schema-valid progress, merges camera data deterministically and validates/writes the result. Both handled errors and abrupt child exit clean siblings; callback exceptions also reap children. Backend forced termination must target the whole process tree.
- Actual initial clean30 CLI run emitted three distinct child PIDs and completed with expected map/debug output. New six-test concurrency suite passed in 14.78 seconds; read-only agent review found no blocker, and identified the documented Python main-guard requirement.
- Perspective tests for 60 phones pass without tracker changes: all ordinary phones localized, including six-pixel rear widths; deliberately 1x2-pixel last-row phones stay unseen while 48 others localize. The 90-phone 1280x720 review has 37x59 front down to 12x18 rear screens; inspected its preview and confirmed visible perspective scaling.
- Benchmark agent now measures live Windows parent+descendant resident memory rather than mistaking parent peak for all processes. A controlled 96MiB child verifies inclusion. The strict accepted-observation check found a ground-truth border bug: device54 rounds to an in-frame pixel bbox despite its ideal continuous bounds. Corrected truth only; no encoding/decoder change. Added a 90-phone regression.
- Uncontended dense runs on identical existing 4K clips: serial 97.8005 seconds, parallel 32.1931 seconds (about 3.04x); both 1500/1500 correct, complete results identical except processingMs. Peak sampled aggregate memory 307,130,368 versus 840,060,928 bytes; no sampling errors/gaps. Synthetic 90-second target is met; physical performance remains unmeasured.
- Perspective 90 benchmark: 90/90, front 36 / middle 24 / back 30 all correct; zero wrong accepted camera observations, max canonical error 0.003719747, 4.8596 seconds and 302,555,136 bytes sampled aggregate. Metrics copied into evidence; no raw clips committed.
- First combined gate: 72 passed, one failed. Newly added 90-phone automated case unintentionally used capture helper's 640x360 default, unlike the 1280x720 review clip. Device 61 was ambiguous. Investigation: at 640x360, 72 localized / 17 ambiguous / one unseen, all 196 accepted observations correct (under .87 px). Compressed rear rows trigger association/merge rejection; valid alternate camera observations outside supported geometry cannot rescue those locations. Keep that exact input as a conservative safety regression; explicitly set 1280x720 for the 90-phone full-recall test and retain full-recall 60-phone 640x360 test. No threshold changes.

## Final verification and handoff

- Four focused perspective tests passed in 26.72 seconds. Final combined gate passed all 74 Python tests in 105.23 seconds plus shared schema/fixture drift, boundaries, typecheck, lint and contracts. Standalone worker/tool Ruff, whitespace checks and local documentation links pass. Raw videos/results remain ignored.
- Updated worker README, fixture README, Team 3 stage/status/handoff and a new evidence report with small raw benchmark JSONs. Existing historical report remains unchanged. No root/shared schema/dependency/reference-source edits were made.
- Default CLI now uses three camera processes; --workers 1 is the serial reference. Team 1 must terminate the complete process tree on forced cancellation; direct Python spawn callers need a main guard. Team 4's result/artifact schema is unchanged. Decoder implementation label is otc-v1.1, frozen wire/codebook still v1.
- User-facing clips are runtime/otc-fixtures/perspective/camera-0.mp4 through camera-2.mp4, with preview.png, debug/ and independent truth. Queued camera-1 in the file viewer. Captures remain synthetic and do not calibrate the photo's tiers/balcony.
- Next acceptance remains physical front/back-row recordings after Team 2's renderer exists; camera stabilization is outside this change. Preserve conservative rejection in low-resolution crowds and measure original-camera performance before ceremony claims.
