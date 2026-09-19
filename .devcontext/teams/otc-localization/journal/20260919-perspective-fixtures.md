# Perspective fixture implementation

Date: 2026-09-19. Agent: perspective-fixtures. Team: OTC localization.
Branch: feat/otc-localization. Starting feature commit: 49328c3; foundation-v1: ab59c27105627977ee52dc2bcd4276b4532b9e2a.

## Assumptions and owned scope

The user's auditorium photo establishes a need for screens to shrink with distance; it is a side view, not a camera calibration. Model original synthetic geometry, without embedding the photo or claiming venue dimensions. Keep the existing fixture cases unchanged. Parent owns worker changes and integration.

Owned files: tools/otc-fixtures/generate.py, tools/otc-fixtures/README.md, workers/otc/tests/test_perspective.py, this journal.

## Plan and success criteria

1. Add a projective audience view with converging columns and compressed rear-row spacing; scale screen width and height by inverse depth. Verify independent truth records projected screen sizes and depths.
2. Decode actual H.264 clips and require correct near/middle/back IDs and canonical positions. Explicitly undersized rear screens must remain unknown; no wrong accepted identities/positions.
3. Generate a 90-device 1280x720 example under ignored runtime/otc-fixtures/perspective, record hashes and limitations, and run focused pytest plus fixture-tool lint.

Physical back-row visibility, rolling shutter, noise and sensor exposure remain untested until actual capture is possible. Synthetic image dimensions are not a measured real-camera detection guarantee.

## Implementation and experiments

- Added `perspective`: the audience plane uses a homography with inverse depth `1 / (1 + 3*y)`, compressing row spacing and narrowing rows at the back. Billboard phone width/height shrink by that same inverse-depth factor. Existing fixture cases retain their rendering behavior.
- Added `perspective-undersized`: deliberately render only the last row at 1x2 native pixels. This is an isolated resolution-limit injection, not a claim those phones have equal physical screen size under the ordinary perspective model.
- Truth remains independent of the decoder. Each perspective phone records depth, expectedUnresolvable and per-camera ideal center/rendered dimensions/visibility. Assertions check accepted camera observations directly, so geometry rejection cannot conceal an incorrect accepted identity.
- First test draft wrongly compared the smallest screen in the entire front third with twice the smallest rear screen using a strict greater-than; the actual sizes were 12 and 6. Corrected the intended frontmost/backmost comparison (17 and 6). This was a geometry assertion mistake, not a decoding failure or relaxed identity threshold.
- Focused test command: `.\.venv\Scripts\python.exe -m pytest workers/otc/tests/test_perspective.py -q` -> 2 passed in 11.06 seconds. Both actual 3-camera H.264 cases contain 60 participants at 640x360. Ordinary perspective localized all 60; undersized localized 48 and left all 12 deliberately tiny phones unseen. Accepted camera positions are within 2 pixels of independent truth, final positions within 0.015, with successful front/middle/back coverage. No tracker/decoder threshold changes were required.
- Subsequently added a direct assertion that horizontal row span also converges; the parent will include this final assertion in the integration gate. Fixture-tool/test lint and `git diff --check` pass.
- Generated review clips with `.\.venv\Scripts\python.exe tools/otc-fixtures/generate.py --output-dir runtime/otc-fixtures/perspective --case perspective --count 90 --width 1280 --height 720 --seed 7`.
- Processed the review fixture with `python -m otc process --manifest runtime/otc-fixtures/perspective/manifest.json --output runtime/otc-fixtures/perspective/result.json --evidence synthetic --debug-dir runtime/otc-fixtures/perspective/debug`. Parent's new multiprocessing implementation ran three camera PIDs. Result: 90/90 localized, maximum normalized error 0.0037197470678100274, worker processing 6688.0053ms (not an isolated performance benchmark). Native screen sizes range from 37x59 to 12x18 pixels, roughly tenfold area variation.
- Visually inspected `runtime/otc-fixtures/perspective/preview.png`, extracted from camera-1 at 2100ms: obvious rearward size reduction and converging rows. All generated MP4s/truth/results/debug/preview remain ignored under runtime.
- Benchmark agent caught a truth-only visibility bug in the 90-phone sample: device 54 in camera-left has ideal center x=7.4418604651 with screen width 16. Its raster x0 rounds to 0, so its 16x26 rectangle is fully inside; the original continuous center>=width/2 test incorrectly marked it invisible. Changed truth visibility to the same rounded bbox inclusion used by rendering, without changing screen rendering or weakening accepted-observation checks. Updated this field in the ignored sample truth; MP4 hashes/result remain unchanged. The benchmark's lightweight `perspective_accuracy` check now reports zero wrong accepted observations and zero missing expected resolvable IDs. Added a 90-device perspective parameter to automated tests to cover this near-edge rounding scenario; parent runs the final gate after uncontended performance measurements.

## Review artifact hashes

Directory: `C:/Users/nicho/OneDrive/Desktop/HackTheNorth/runtime/otc-fixtures/perspective/`.

| Clip | SHA-256 |
| --- | --- |
| camera-0.mp4 | b87a949c990ea81b91d00f4b8dac1d0046d92ee2510f449b2c74775022d59532 |
| camera-1.mp4 | bc3e5edda77b7e9463708d668b365560570a4e8ac0f7231ee01d725dd915f752 |
| camera-2.mp4 | 4e64c1e544674e0a8979ddfbf8ce27e32c78305445ea76a3ea21a7f5304863c5 |

## Handoff and limits

Parent owns final gate and commit. README now documents these cases, exact commands and the benchmark agent's new workers/memory/accuracy fields. No shared contracts, dependencies, tracker or camera pipeline were edited by this agent.

The 60/90-device scenarios isolate perspective size differences. Screen sizes scale with resolution, not inversely with participant count: very dense perspective scenes can overlap in compressed rear rows and correctly yield ambiguity/unknown. Keep the 1,500-device clean fixture as the independent computational scaling benchmark; do not imply this perspective demonstration proves physical crowded-venue recall. No real-camera noise/exposure/rolling-shutter/tiers or camera-motion compensation is introduced here.

## Integration regression: explicitly test review resolution and crowding limit

The parent's first integration gate failed the newly added 90-device test: its shared capture helper implicitly used 640x360, while the successfully reviewed 90-device clips were 1280x720. The previous 60-device cases passed unchanged. Reprocessed the exact failing clips from `C:/Users/nicho/AppData/Local/Temp/pytest-of-nicho/pytest-16/perspective-90-300/` with debug artifacts under `runtime/otc-fixtures/perspective-lowres-debug/` and `perspective-lowres-result.json`.

Observed at 90 phones / 640x360: 72 localized, 17 ambiguous, one unseen. All 196 accepted camera observations are correct (maximum center error 0.86969px); maximum normalized error among localized phones is 0.00464747. Device 61 illustrates the conservative path: its primary camera track decoded the correct bits but was marked ambiguous by screen association; correctly accepted observations in other views are outside trustworthy mapped support, so no location is fabricated. Compressed rear-row spacing and H.264 contours also create short merged/size-changing tracks. No decoder or geometry acceptance thresholds were changed.

Parent granted ownership of `workers/otc/tests/conftest.py` to add optional width/height and dimension-aware fixture caching. The full-recall 90-device test now explicitly uses 1280x720, matching the sample being tested and covering its raster-edge visibility bug. The failing 640x360 case is retained as a fourth safety test: all front/middle phones still localize, uncertain rear positions remain null, there must be observable rear uncertainty, and every accepted observation/position must remain correct. This records a demonstrated resolution/crowding limitation rather than discarding it or pretending all resolutions have equal recall.

Final focused verification: `.\.venv\Scripts\python.exe -m pytest workers/otc/tests/test_perspective.py -q` -> **4 passed in 26.72 seconds**. Ruff checks for generator, perspective tests and updated conftest pass; `git diff --check` has no whitespace errors (existing parallel context files reported only line-ending normalization warnings). Parent owns the final full gate and commit.
