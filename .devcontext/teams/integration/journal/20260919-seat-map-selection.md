# Camera geometry and audience selection

Date: 2026-09-19. Owner: integration captain under the user's cross-team integration request. Baseline main 7f09062; clean working tree at start. Preserve decoder v1.5's verified identity extraction.

## Request and diagnosis

The user reports four correctly decoded devices but no seat coordinates or visible dots. Live run af30bff2-282d-4bb6-a947-bf1159ce2088 has one camera-center recording and anchors=null. Worker manual_mapping therefore returns no transform and produces honest optical-column/coarse locations with null x/y. MapPanel skips all non-localized records, rendering a blank map. Its localized markers are only 2px, selection is mouse-only, and selected IDs from external column buttons do not feed back into the canvas highlight.

The user confirmed cameras face from the stage toward the audience. Audience left is image-right in this arrangement. The three musical channels remain Melody/Vocals/Percussion; left/center/right are spatial groupings.

## Plan and constraints

- Make existing four-anchor calibration usable from either the chosen original recording or the completed job's full-resolution preview, including after page reload. Read saved upload geometry instead of accidentally resetting it to null. Add an explicit frame-layout preset with the confirmed orientation for approximate testing; do not call image-frame coordinates measured seats.
- Preserve the current wire protocol and decoder. One, two or three selected cameras independently map their specified column using their own anchors; missing views do not block mapped views. Add focused geometry coverage for camera counts and stage-facing orientation.
- Show decoded column-only devices in clearly labeled groups while their row positions are unavailable. Make localized markers visible/labeled, selectable by click/box/lasso, and support draggable region dividers with exact, non-overlapping ID sets. Keep map revision checks.
- Verify admin/selection and OTC gates plus a physical-file reprocess and live candidate/review/assignment UI. Avoid restarting the backend because it holds the current completed capture; worker code loads per job and frontend code hot refreshes.

## Implementation and decisions

- Added pure frame-anchor/orientation and convex geometry validation helpers. The original recording or the completed worker preview supplies the image, with rotation applied only once. Uploaded geometry and exclusions survive reload. Four-corner entry remains open until complete; malformed corners fail before upload/processing.
- Process saves visible geometry edits before requesting the worker job. An old candidate cannot be committed while its visible geometry is dirty. Existing backend contract and worker decoder are unchanged.
- Added labeled visible map dots, column-only fallback lists, pointer capture for click/box/lasso, external-selection highlights, and movable vertical region dividers. Region sets are disjoint, localized-only and carry mapRevision. Existing authoritative assignment/undo handling is reused.
- Added tests for stage-facing orientation, invalid anchors, region boundaries and one/two/three camera transforms. No generated fixtures, lockfiles, contracts or reference code changed.
- See [decision](../../../decisions/20260919-seat-layout-and-regions.md) and [operator instructions](../../../../docs/audience-mapping.md).

## Physical file and live UI experiment

Input: uploaded WIN_20260919_18_07_08_Pro.mp4, 32,477,838 bytes, SHA256 `6a8d5be56dcf5ae1a600fc19f0f1e2a3336e2fe517adc9cdd8dc844332ee2044`. Raw video and debug images remain ignored local runtime artifacts, not Git data. Run af30bff2-282d-4bb6-a947-bf1159ce2088, run tag 16, one camera-center recording. Four completed participants: 14, 15, 17, 21.

Starting state: all four IDs decoded, anchors null, all four coarse with null x/y. Used the visible preset with stage-facing orientation on the 1920x1080 preview; saved corners were (1919,1079), (0,1079), (0,0), (1919,0). Clicked Process uploaded recordings without a separate Save action, verifying automatic geometry submission. Job 0346e6e3-4687-4285-9658-e13673672db8 completed in 31.2 seconds with four accepted/localized IDs and no warnings:

| Device | x | y |
| --- | --- | --- |
| 14 | 0.53544 | 0.30723 |
| 15 | 0.40822 | 0.31593 |
| 17 | 0.37680 | 0.78072 |
| 21 | 0.48391 | 0.28998 |

Candidate canvas visibly plotted all four labeled dots. Checked the review acknowledgment and committed it: map revision 9 → 10. Prior untargeted locations were preserved. No playback or musical assignment change was issued, and the backend/epoch were not restarted.

Actual UI verification on the Assign tab: click selected one phone; dragging a rectangle selected all four; dragging dividers to approximately x=0.45 and 0.51 produced left=2, center=1, right=1. Region highlights and selected counts followed the controls. A first coordinate-based test click missed because the screenshot display was scaled; using the canvas's rendered DOM bounds verified the actual coordinate inverse without changing application code. Lasso's geometry is covered by the existing pure polygon tests; a physical touch-device gesture was not tested.

Physical limitation observed: device 17 is held overhead while the other phones are lower. Its image-based y places it farther back; this is not evidence of actual seat depth. Added explicit approximation guidance to candidate review and the operator guide. Actual venue seat accuracy still needs four known seating corners per camera, consistent phone height, and physical orientation/order checks.

## Verification and handoff

- `bun run gate:otc`: PASS, shared contracts 14 tests plus Ruff and **106 Python tests** (123.31 seconds). Decoder source unchanged.
- `bun run gate:admin`: final run PASS, **24 admin/selection tests**, 56 assertions, plus 14 shared contract tests, repository typecheck/lint and optimized production build. This run includes the approximation notice, saved exclusion hydration and dirty-geometry commit guard.
- Direct focused geometry tests: 14 Python tests passed. Focused selection/anchor tests passed before the complete gates.
- Local gate logs: runtime/local/gate-seat-map-admin-final.log and runtime/local/gate-seat-map-otc.log (ignored).
- `git diff --check`: PASS. Status: software and local-file/UI workflow verified on this working tree; venue seat accuracy and physical touch gestures remain unverified. Changes are uncommitted at handoff.

Next operator action: use Assign to group the visible devices and choose Melody/Vocals/Percussion. For the venue, record fixed stage-facing views, set known seating corners, review the map, and verify near/far placement physically. Reopening Assign resets its local divider placement; accepted assignments remain durable. No cloud deployment was needed.
