# Concerto metal UI

Date: 2026-09-20. Owner: integration captain under the user's cross-application UI and product rename request. Baseline: main / 4c69320900be6399ef0dbd8102230a3cee621666; clean working tree. Foundation: ab59c27105627977ee52dc2bcd4276b4532b9e2a.

## Plan and boundaries

- Own this integrated presentation slice: audience root/present/upload styles and components, operator branding/theme, user-facing metadata/docs, required dependency/lockfile and smoke expectation updates. No shared wire contracts, timing, optical renderer, audio scheduling, reference source or saved live show changes.
- User clarified the suggested package as https://libraries.dev/orbs. Use pinned thinking-orbs with monochrome styling, reduced-motion behavior and no animation during calibration/performance. Brushed silver and dark inset surfaces establish the metal aesthetic without another graphics dependency.
- Simplify audience instructions to current actions and one readiness summary; retain detailed checks in disclosure and all recovery/section actions. Projector emphasizes Concerto, QR and real aggregate counts; offline counts remain unknown.
- Preserve internal @orchestra package names, storage keys and service identifiers for compatibility; rename public product branding to Concerto. Existing user-authored show titles are data, not branding to rewrite.
- Verify from repository root with gate:client, gate:admin, production smoke, and isolated browser inspection at phone/projector sizes. Record physical QR-distance/mobile/audio checks separately. Do not reset/restart the live backend for verification.

Status: implemented and verified in software/browser; physical checks remain separate.

## Implementation and experiments

- Added thinking-orbs 0.3.1 (MIT notice retained), chrome bezel, brushed silver audience/projector/upload surfaces, dark inset buttons and neutral operator styling. Audience orb pauses while hidden, calibrating, playing or reset; the package additionally honors reduced motion and offscreen suspension.
- Renamed visible product labels, metadata, the new-show default and README to Concerto. Existing package/storage/service identifiers and saved show data remain compatible. Updated smoke selectors to the shorter projector copy.
- Root shows one readiness disclosure, a single sound-unlock action when needed, concise contextual instructions and preserved section/reconnect/reset flows. Playback and calibration overlays are unchanged.
- Initial 1280x720 projector layout measured 755px document height. Reduced the compact QR bound by 50px; final measurements are exactly 1280x720 and 1920x1080, without page overflow. QR retains a white four-module quiet zone.
- Browser availability: Chrome connector unavailable; used Codex's in-app Chromium browser. The isolated built-app harness on 18090 kept test identity/section/reset changes out of the live show.

## Checks actually run

- `bun run gate:client`: PASS, 19 shared contract tests and 160 client/audio tests (942 assertions), typecheck/lint/boundaries/fixtures and production build. Log: `runtime/concerto-gate-client.log`.
- `bun run gate:admin`: PASS, 19 shared contract tests and 25 admin/selection tests (65 assertions), shared checks and production build. Log: `runtime/concerto-gate-admin.log`.
- `bun scripts/build.ts client`: PASS after the compact QR sizing adjustment. `bun run test:smoke`: PASS for backend health and all four production routes. Logs: `runtime/concerto-build-client.log`, `runtime/concerto-smoke.log`.
- Real browser: 390x844 audience view and expanded diagnostics fit without overflow; 320x568 retains all controls with vertical scrolling and no horizontal overflow. Automatic connection/sync/verified assets, one-tap sound control, manual Center left selection followed by confirmed Vocals, operator login, and isolated audience reset all work. No browser console errors in the audience check. Projector fit verified at both 720p and 1080p.
- Browser audio reached running but remained output-warming in this embedded environment. Do not infer audible readiness or physical acoustic behavior from this inspection. Existing output gating is preserved.
- Physical: no new phone, camera, acoustic or projector-distance QR scan performed. Rehearse those on real devices. No live reset/backend restart, deployment, commit or push performed.

## Handoff

Refresh `/` and `/present` to review Concerto on the existing development server. Check QR scanning from the intended projection distance and real iOS/Android sound unlock. No contract migration or saved-show edits are needed. Historical team stage documents remain physical acceptance references, not UI completion claims.
