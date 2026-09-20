# Automatic stage-facing layout for camera uploads

Date: 2026-09-19. Owner: integration captain, across sync/control, admin, client and OTC boundaries under the user's explicit integration/fix request. Status: accepted.
Supersedes the explicit-opt-in frame-preset requirement in 20260919-seat-layout-and-regions.md; preserves that decision's measured-corner workflow and selection conventions.

The phone uploader introduced a regression in the usable workflow: it provided no seating transform, so every new run needed a separate manual preset before any dot appeared. The user has confirmed that recording cameras face from the stage toward the audience and requires positioning to work on upload.

Add optional CameraInput.frameLayout (from-stage/from-back). New phone and admin uploads request from-stage automatically. Four explicit anchors take precedence; missing anchors plus frameLayout derive an approximate full-frame transform from the actual rotated video dimensions in the worker. Missing both retains the old honest column-only behavior for old manifests and explicit column-only operation. Old uploads shown in the admin default to the known stage orientation on the next Process request, which saves that metadata before creating a job.

Add Location.mappingMode = frame-layout for localized approximate screen positions, so results never mislabel them as measured anchors. All consumers/schema generation move together; new backend/frontend builds must be loaded together. Each camera still maps its labeled third independently. Do not seed overlap registration from an approximate frame transform. Orientation and optional seating corners remain editable. The UI distinguishes approximate map positions from seat coordinates and requires review before committing. No inferred identity, invented row index, or GPS claim.

Verify rotated native dimensions, one/two/three views, missing metadata compatibility, manual-anchor precedence, upload-to-manifest propagation and stale-geometry protection. Actual phone height and camera perspective remain limitations; known seating corners improve the rough layout.
