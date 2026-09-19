# 1,500-phone auditorium sweep fixture - 2026-09-19

Branch feat/otc-localization; baseline f962895. User asked for a large perspective clip whose horizontal/vertical spacing follows the auditorium reference image. Delivered an original synthetic seating bowl, not a calibrated reconstruction or a moving-camera sweep.

## Reproduce and view

```powershell
.\.venv\Scripts\python.exe tools/otc-fixtures/auditorium.py --output-dir runtime/otc-fixtures/auditorium-1500
```

Use a new output directory on reruns. Main viewing artifact: `runtime/otc-fixtures/auditorium-1500/overview.mp4`. Also generated `camera-left.mp4`, `camera-center.mp4`, `camera-right.mp4`, per-view preview PNGs, `scene.json`, independent `ground-truth.json`, and a three-camera `manifest.json`. A decoded overview data frame is saved as `overview-data-preview.png`. Large artifacts stay ignored; generator and small evidence reports are committed.

All four clips are H.264, 3840x2160, 30 fps, 13.5 seconds / 405 frames, rendering the unchanged 55-symbol OTC v1 packet at 200 ms per symbol with independently offset camera capture phases. [Media audit and SHA-256 hashes](auditorium-1500-media.json).

## Geometry assumptions

- Exactly 1,500 unique phone IDs across 30 curved rows; row seat counts increase from 22 to 78 toward the back, split into three seating blocks.
- Physical seat pitch 0.58 m, with an additional 1.2 m at each of two aisle gaps. Row radii 10..36.1 m. The floor profile `0.26 * row + 0.01 * row^2` raises the rear tiers progressively for a synthetic line of sight.
- Every screen is 0.08x0.16 m, upright and facing the stage, projected as a quadrilateral. Apparent size and horizontal/vertical gaps follow the 3D projection; screens are not resized to meet decoder thresholds.
- Monochrome seat backs and terrace edges show the sweep. The fixed stage origin is shared across views: overview horizontal FOV 94 degrees; close views 54 degrees with yaw -27/0/+27 degrees; pitch 13 degrees.
- Overview includes all 1,500 phones, with native screen bounding widths 4..35 px and heights 7..41 px. Left/right close views each include 775 complete phones (777 at least partial); center includes 1,046 complete (1,056 at least partial). Close-view widths are 8..46 px. Counts include overlap across views and must not be summed as distinct participants.

No dimensions were measured from the photograph. The balcony, people/body occlusion, hand movement, sensor effects and camera translation are omitted. Null manifest anchors are intentional: a curved/raked audience is not a single planar canonical map. This artifact can exercise video/ID processing and explicit coarse outcomes; no full-location recall claim is made. The overview is for viewing and is not added as a fourth processing camera.

## Verification

- Two new geometry tests passed in 0.43 seconds: exact ID/row count, circular row shape, rising tiers, seat/aisle spacing, full overview frustum coverage, distance-dependent screen sizes, and a per-ID label raster confirming no phone is completely occluded by another phone before compression.
- Decoded all four final MP4s: each is 3840x2160, 405 frames with strictly increasing PTS from 0 to 13,467 ms. File hashes match metadata. At the encoded data frame around 6,167 ms, sampled 25/9/20/16 in-frame phone colors in overview/left/center/right; all 70 symbols matched their frozen codewords. This sample is a media sanity check, not a full packet-decoding/venue-recall benchmark.
- Visually inspected full overview and close-view scene previews, plus the overview frame extracted after compression. Curved rows, rising tiers, two aisles and small rear screens are visible.
- Full `bun run gate:otc`: 76 Python tests passed in 90.07 seconds, plus shared schema/fixture drift, boundaries, typecheck, lint and contract checks. Worker/fixture Ruff and whitespace checks pass. The pre-existing root contract filter still includes two ignored isolation copies; captain owns that correction.

Software environment remains the pinned Python 3.13.15 / PyAV 18.1.0 / OpenCV 4.13.0 / NumPy 2.4.6 installation from prior evidence. Existing fixtures, production decoder, schemas and dependencies are unchanged.
