# Stage 04 - Admin and DJ console

Status: not started (read-only fixture preview provided). Owner: Team 4 lead. Branch: feat/admin-console. Base: foundation-v1.

## Agent assignment

> Implement Team 4 from masterplan sections 4, 7 and 8. Own admin-frontend/, packages/selection/ and tools/admin-demo/. Start with pure tested selection, then typed adapter and fixture-driven upload/review/assign/perform flow. Distinguish server-confirmed/pending state and synthetic/physical evidence. Keep journals/status/handoff current. Build the scoped multitrack controller, not a full DAW.

## Available and runnable

Next shell with development 1,500-device/readiness preview; selection interfaces; shared show/transport/map schemas; tones; mock snapshot/probe/broadcasts. Interactive selection, uploads/jobs and timeline commands are not implemented.

Run `bun run dev:admin-demo` (3001 + 18084); verify `bun run gate:admin`. Extend branch-owned scenarios in tools/admin-demo for ACKs, pending state, jobs, errors/reconnect and stale revisions. 1,500 fixture dots are not connected phones.

## Ordered slices and acceptance

1. Pure rectangle/polygon selection returns explicit IDs + mapRevision. Test audience-left orientation, boundaries, unknown/coarse filtering, uniqueness and 1,500-point cost.
2. Typed adapter with separate mock/production wiring: server acceptance/errors, pending versus effective state, stale-map refresh. Never display optimistic fake success.
3. Calibration prepare/ready/arm, camera slots, upload versus processing progress, anchors/rotation/exclusions, rejection review and explicit map commit. One failed camera does not erase other uploads.
4. Assignment region/column preview, counts/channel, scheduled ID set, clear/manual fallback and previous-set restore. Include map/revision identity.
5. Four-lane timeline: common server-clock playhead, clips/waveforms, play/pause/stop/seek, gains/mute/solo, readiness/countdown, stopped edits and persistent panic. Inject shared clock; do not build another estimator.
6. Integrated operator walkthrough including incomplete localization, retry, reconnect, stale selection and panic; record interaction performance and physical evidence.

## Handoff

Send Team 1 exact command/error examples and Team 3 review/metadata needs. Use goldens while decoding proceeds. Add selection and adapter/workflow tests to gate; physical walkthrough follows producer integration.
