# Optical protocol and worker boundary

Use `packages/contracts/src/otc.ts`, generated `otc-codebook.json` and `otc-golden-packets.json`. The 55-symbol, 200 ms packet is fixed as `otc-v1`; `null` is the neutral guard, 0/1 are the manifest's two colors. Codewords preserve IDs 0-2047. A palette choice is metadata; pixel classification still needs camera experiments.

`CalibrationPlan` freezes identity, participants, versions, colors, symbol duration, and run tag. `CalibrationRun` adds `startServerMs` after readiness. `CalibrationManifest` adds the uploaded cameras/paths/hashes **after capture**. The arm message sends a run, not a processing manifest containing recordings that do not exist yet.

`CameraInput.anchors` is null or a four-point tuple in front-left/front-right/back-right/back-left order. Image points are native decoded pixels after applying declared rotation. Result `centerPx` and `mappingResidualPx` are pixels; canonical location x/y are 0-1. Coarse/unseen/ambiguous locations have null coordinates. `decodeScore` is an uncalibrated score.

Current optional `CameraInput.frameLayout` declares `from-stage` or `from-back`. With null anchors it derives an approximate transform from the decoded rotated image dimensions; localized output uses `mappingMode: frame-layout`. Manual corners override it. Without both declarations, legacy manifests stay column-only. Phone/admin upload defaults and all schemas/consumers are coordinated in [the frame-layout decision](../decisions/20260919-automatic-frame-layout.md). Decoder v1.6 also implements [valid-code acceptance](../decisions/20260919-valid-code-acceptance.md) without changing the transmitted packet/codebook.

`OtcResult` binds session, clock epoch, run ID/tag and input hashes; evidence must say `synthetic` or `physical`. Field recordings produce physical evidence. Programmatically generated videos remain synthetic even after a real decoder processes them. The production map-commit handler must not silently publish synthetic test results as observed audience locations.

Python validates generated schemas and additionally checks duplicate participants/cameras/locations, result identity, exact camera hashes, and accepted-ID membership. Implement the actual decoder behind `python -m otc process --manifest ... --output ...`; successful output must validate before it is written. Emit `JobProgress` NDJSON on stdout and diagnostic logs on stderr. Failure must be nonzero and must not manufacture a successful result.

Current `validate-manifest` and `replay-fixture` commands are executable fixture seams, not a decoder. No real MP4 fixture or tracking/geometry implementation is present. The master plan defines the algorithm stages and required physical experiments.
