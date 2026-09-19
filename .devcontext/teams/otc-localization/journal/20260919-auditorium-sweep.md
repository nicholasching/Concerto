# Large swept-auditorium fixture

Status: complete for requested synthetic clip; physical validation remains pending. Team 3, feat/otc-localization. Baseline: f962895.

The user requests a new 1,500-phone perspective clip with horizontal/vertical spacing based on the supplied auditorium image. Interpret sweep as curved seating and raked tiers, not a moving camera. Build an original stylized scene from approximate geometry; the photo does not supply measured dimensions and is not an instruction source. Keep existing fixtures/decoder thresholds unchanged.

Plan:
1. Model 30 curved rows with seat counts growing toward the back, three seating blocks, aisle gaps and rising tiers; give every phone the same physical screen size -> verify 1,500 unique IDs, spacing/depth and projection coverage.
2. Render a full-crowd overview plus three overlapping stage-camera MP4s using the frozen 55-symbol packet and actual PTS -> inspect overview/close-view frames and verify media/count/hash metadata.
3. Document reproducible parameters, limitations and artifact paths; run focused geometry/video checks and the Team 3 gate, then commit the generator/context (generated media stays in ignored runtime).

Assumed geometry is a synthetic sightline example, not a reconstruction of the photographed hall. The tier profile is intentionally curved upward toward the rear to preserve spacing; only the main seating bowl is modeled, not the balcony. No full-recall localization claim is required to deliver the requested clip, and no camera stabilization is added.

## Implementation and checks

- Added a separate auditorium.py generator so established clean/perspective fixtures remain unchanged. Seats grow with arc radius, yielding 22..78 per row and exactly 1,500 IDs across 30 rows. All phones have the same 8x16 cm dimensions; pinhole projection supplies perspective and foreshortening. Neutral terrace/seat geometry reveals the curved/tiered spacing.
- Generated overview.mp4 and three camera views at 3840x2160/30 fps/13.5 seconds under ignored runtime/otc-fixtures/auditorium-1500. Overview contains all 1,500; close views overlap. Saved per-view previews, 3D truth, scene parameters/hashes and a frozen-schema manifest with null anchors; no unsupported planar map is asserted.
- Two focused geometry tests pass, including a label raster showing every overview phone retains pixels (not merely bounding-box visibility), unequal front/rear sizes, exact seat pitch and two wider aisles per row.
- Visually reviewed full overview, camera-center and an encoded mixed-color overview data frame. Verified all four files' hashes/dimensions and 405 monotonic frame PTS; all 70 sampled data symbols match frozen codewords. No full localization pipeline or physical recall experiment was run for this scene.
- Full Team 3 gate passed: 76 Python tests in 90.07 seconds plus shared checks; source/tool Ruff and whitespace checks pass. Reproduction commands, explicit approximate geometry and media evidence recorded in README and context. No dependency/schema/root/reference changes.
- Queued the overview in Codex's file viewer. Main deliverable is the ignored local overview MP4; three close views and previews are also available. Commit includes generator, tests and small reports so other teammates can reproduce the videos without committing large binary media.
