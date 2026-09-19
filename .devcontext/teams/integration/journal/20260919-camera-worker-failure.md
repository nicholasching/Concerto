# Camera processing failure investigation

Date: 2026-09-19. Captain / main baseline 6e1f4d4; worktree clean at start. User reports camera processing fails at 5% with exit code 2. Preserve the active calibration and original uploads; no backend restart or map commit during diagnosis.

Initial evidence: all three retained job records contain the worker JSON error `Camera camera-center: ValueError: Too many screen tracks; inspect exclusions or camera motion`. Upload/hash validation completed. The worker's tracker caps the cumulative list at 8192; stale tracks remain in that list. The console displays only progress.message, hiding available diagnostics.

Plan: inspect source recording metadata/representative frames and reproduce tracker growth; determine a bounded fix without weakening identity acceptance; expose useful worker diagnostics; run focused regression/gates and reprocess the same immutable bytes into a separate diagnostic result. Physical recordings and extracted frames stay in ignored runtime paths. No success or mapping claim until measured.

## Reproduction and implementation

- Input: original H.264, 1920x1080, approximately 30 fps with actual PTS, 1306 frames / 43.524 s / 98,129,969 bytes. SHA-256 `463b19f376ce050b9b0aa6732931b8e4b8db345df2a3bd10dc8ad928179096f1`. All three uploaded camera slots contain these same bytes; they are one view, not independent three-camera evidence.
- Original tracker reproduced the failure on frame 269 / PTS 8928.5 ms: 8192 cumulative tracks, 504 active entries, 7650 expired fragments with fewer than the existing 40-sample decoder minimum. Peak detections per frame was 298; this was accumulated background-fragment churn, not 8192 visible phones. The first-frame scene and later pattern frames were inspected locally; no private frames were committed or sent to external services.
- Decoder v1.3 now retires only expired fragments that cannot meet the unchanged decoder minimum. It preserves active/potentially decodable tracks and ambiguity reasons, remaps active indices during compaction, retains unique monotonic track IDs, and leaves the 8192 retained-track resource guard intact. Packet/phase/identity acceptance thresholds are unchanged. Camera diagnostics count discarded fragments explicitly.
- Console failure messages now include the worker's JSON error, plus expandable raw diagnostics. Existing failed jobs immediately show their actual reason without restarting the backend. This avoids losing the in-memory calibration and current uploads.

## Checks and actual result

- Targeted tracking and diagnostic-format tests: 7 Python / 2 JS passed. Regressions include more than 8192 transient fragments with one continuous retained screen, active-index/ID preservation, unchanged ambiguity reasons and retained resource-limit rejection.
- `bun run gate:otc`: PASS, 82 Python tests, Ruff, 14 contracts and shared type/lint/schema/fixture/boundary checks.
- `bun run gate:admin`: PASS, 21 JS tests, 14 contracts, shared checks and production console build. Gate logs in ignored `runtime/camera-diagnosis/`.
- Same original bytes processed with one camera via the real CLI: exit 0, 46.7 seconds, discarded 35,574 expired fragments. Result/debug artifacts under ignored `runtime/camera-diagnosis/repaired-single.*`.
- Real console: confirmed the old job now displays its detailed error, then clicked Retry processing for the existing three uploads. New job completed at 100% in 53.5 seconds. No backend restart, upload replacement, new run, transport change or map commit. The original recording and run remain available.

## Remaining limitation and handoff

Crash fixed; optical identity recovery is still unresolved for this recording. All three copies report zero accepted / 523 rejected tracks, no complete pilot/preamble, and four eligible devices unseen. Representative pattern frames contain visible flashing phones, but the broad color detector does not isolate them consistently from the real background/nearby colored regions. One visible foreground phone remains on its normal UI in the inspected pattern frames; the run also reports one other device interrupted for clock readiness. These observations do not establish the IDs of the physical people/phones in the images.

Do not commit this empty candidate or claim successful physical calibration. Next optical work: characterize segmentation/association on real phone/background crops, retain conservative tag/codeword checks and verify against independently known device IDs. For a single-camera experiment upload one view once; distinct left/center/right slots should receive distinct recordings. Current live candidate is deliberately uncommitted. Raw footage and frames remain local/ignored; source reference and contracts remain unchanged.
