# Consistent Concerto admin and camera UI

Date: 2026-09-20. Owner: integration captain under the user's cross-application UI request. Baseline: main / 94e5520, clean tree after committing and pushing the prior audience alignment changes to origin/main. Foundation/stage ownership and accepted single-origin workflow remain unchanged.

## Plan

- Apply the audience brushed-silver palette, chrome c badge, dark primary controls and minimal typography to admin login/console and camera upload. Retain operational warnings, authentication, calibration review, pending state, routing and show editing.
- Remove redundant slogans, descriptions and repeated counts. Keep longer operational details available where needed; do not hide errors or claim optimistic completion.
- Own admin presentation components/CSS and client upload page/scoped CSS, plus this integration journal. No schema, backend, reference-source, timing, runtime-show or dependency changes.
- Verify gate:admin and gate:client from the root, production smoke, and isolated browser desktop/mobile login, controls, upload/progress/delivery. No tests of decorative implementation details; preserve existing behavior tests. Physical camera/audio checks remain separate.

Status: implementation in progress. The requested pre-makeover checkpoint is published; subsequent makeover will remain reviewable locally.

Map follow-up requested during implementation: replace the contrasting dark map with a transparent drawing over the silver surface, fine dashed boundaries and stage line, smaller outlined dots/dark labels, compact inline section counts and filters, and progressively disclosed evidence notes. Preserve audience coordinates, grouping, selection and explicit physical/synthetic evidence. Scale the canvas backing store to rendered width/device pixel ratio without changing the logical coordinate system. Initial pre-map client/admin gates both passed; rerun admin gate after this change.

Audio-track follow-up: user confirmed the map issue resolved and requested the same seamless treatment for Performance. Replace the dark timeline and saturated blocks with a transparent silver surface, low-opacity channel tints, fine separators/playhead, small channel swatches and compact controls. Preserve timing, clip lengths, waveform data and scheduling. Expose each mute/solo toggle's channel and pressed state to assistive technology. Verify with the admin gate and isolated browser checks.
