# Single-domain stage dashboard

Date: 2026-09-19. Owner: integration captain, authorized by the user's cross-application UI request. Baseline: f71cb1e, mapping work committed and pushed to origin/main before beginning. The working tree was clean after that checkpoint.

## Scope and implementation plan

- Keep the audience at /, mount the existing admin app at /admin, and add /present and /upload under the same Cloudflare origin. Preserve backend authorization and distinct bundles. Configure the requested operator password only in ignored local configuration.
- Replace admin tabs/repeated review with one command page: audience counts, persistent panic/reset controls, Calibration, Assign, Performance, and stage/projector/upload links. Keep advanced geometry/show editing available with progressive disclosure and improve stage-sized controls/contrast/responsive layout.
- Add a tested audience reset: stop output, invalidate credentials and old epochs, clear devices/map/routing/calibration and pending work, preserve prepared show/audio. Existing open audience pages stop and require a fresh page load to rejoin, so reset does not immediately refill the registry. Do not invoke reset on the user's live session as part of development.
- Projector data contains only aggregate counts. Phone video uploads use camera-only access and small resumable requests to avoid Cloudflare's per-request upload limit. All three views feed the existing calibration upload metadata and worker path.
- Attempt audio unlock automatically, prepare verified assets immediately, and show one tap only where the browser requires a gesture. Simplify the audience UI to connection/sync/assets, volume/wait instructions, existing flashing, and mapped section or manual fallback after calibration. Preserve truthful readiness and scheduling.

Checks: focused backend/reset/upload/role tests; participant status/reset/autostart tests; admin adapter tests; gate:sync, gate:client, gate:admin; integrated local and public browser routes, login/projector/upload and responsive visual review. Optical code is unchanged. Production builds and API tests are software evidence; actual mobile autoplay and venue audio remain physical checks.

Status: implementation and software verification complete locally; new UI changes are not committed. The initial mapping checkpoint f71cb1e was pushed as requested. Physical rehearsal remains separate.

## Implementation and experiments

- Added the `/admin` Next zone and same-origin authenticated `/control` HTTP/WSS proxy, public aggregate projector data and QR, and camera-only `/upload`. Password was changed in ignored local `.env` and verified through authenticated local/public requests; it is not embedded in tracked code or documentation.
- Replaced admin tabs with one page, persistent Reset/MUTE ALL, readiness tiles, large Calibration/Assign/Performance controls, musical-part buttons, and collapsible editing/diagnostics. Candidate review is inside Calibration. Removed the former admin QR component; moved validated join-link construction and its tests to the audience app.
- Reset rotates epoch, revokes audience credentials, cancels jobs/preparations/queued work, clears map/routing/devices, and persists the cleared state. Show/media and monotonic run tags remain. Audience close code 4002 clears saved identity and stops automatic rejoin.
- Audience joins, syncs and verifies tracks without an initial interaction. Automatic sound is attempted honestly; one tap remains when autoplay blocks it. Pending track loads now share one promise so automatic startup and a gesture do not duplicate decoding/memory allocation. Existing optical renderer/clock thresholds are unchanged. Completed calibration gives mapped section display or three manual section choices.
- Camera uploads use owned, expiring credentials, exact 8 MiB hashed chunks and streamed concatenation. Resume queries skip accepted chunks; receipt retries are idempotent. Temporary network polling failures retain the token and progress.
- Full HD projector review passed first. The first 720p layout overflowed to 836 px; an initial QR bound still left 767 px. Reduced compact-screen padding/type/QR size and verified **1280 × 720, scrollHeight 720, QR loaded**, with all three counts visible. Phone audience/upload layouts were inspected at **390 × 844**.
- An extra proxy around Next development bundles rendered static HTML but did not hydrate reliably; this was a test-harness failure, not a production assertion. Fixed compression forwarding and used built Next applications for the isolated browser test. `tools/e2e/ui-server.ts` now defaults to those production test ports, with its procedure in the stage guide.

## User's live upload failure and recovery

During testing the user reported “That API route is not implemented by the sync-control service.” Reproduced GET `/api/camera/uploads/:id` returning 501 from the running backend, which predated that resume-status addition. Login/session/start/chunk/complete were already available. Restart would discard their active physical calibration, so added a tested GET-501 compatibility path that safely resends idempotent chunks to the older server.

The next read of the live run showed one received recording in processing; later the same run was committed as physical map revision 3. No live Reset was invoked by the agent. The user independently reset, changed music, captured/uploaded, committed and operated playback while implementation was underway; their edits were preserved. At final handoff the show has two tracks, show revision 3, seven registered devices and transport paused at approximately 139.223 s. Preserve that runtime session. Seat-corner/preset requirements remain unchanged; this new upload's committed map has column locations and no confirmed coordinate positions.

The backend process remains on its earlier stage-dashboard version to preserve that paused show. Current source and built backend include resume-status GET, completed-upload accounting, and projector pattern-finished status; these load on the next normal restart between runs. All requested workflows operate on the running instance with the compatibility path. Do not restart during a calibration or while the operator is using a paused cue.

## Verification

All checks ran from the repository root using Bun 1.3.14 (the ignored `.tools` executable where Bun was absent from PATH).

| Evidence | Result |
| --- | --- |
| Initial `bun run gate` with shared participant stage field | 14 contract, 213 sync, 123 client, 24 admin and 106 Python tests; all builds passed |
| Final `bun run gate:sync` | 214 tests / 2,594 assertions plus 14 shared contract tests; typecheck, lint, boundary/fixture checks and backend build passed |
| Final `bun run gate:client` | 129 tests / 356 assertions plus 14 shared contract tests; checks and production audience build passed |
| Final `bun run gate:admin` | 21 tests / 49 assertions plus 14 shared contract tests; checks and production admin build passed (three QR tests moved to client) |
| `bun run test:e2e` | Passed all real HTTP/WS, three generated MP4/real worker, map/routing/transport/mix/panic and durable-restart assertions in 22.1 s |
| `bun run test:smoke` after final builds | Built backend plus `/`, `/present`, `/upload`, `/admin` HTTP startup checks passed on isolated ports |
| Production browser on isolated port 18090 | Login; upload generated `runtime/otc-fixtures/clean/camera-0.mp4`; delivery visible in center admin slot; automatic connection/sync/verified music; one-tap audio reaches actual ready telemetry; completed/unlocated fallback; Center selection removes choices; reset disconnects audience and retains show |
| Public named origin | `/`, `/admin`, `/present`, `/upload`, `/api/presentation` return 200; unauthenticated operator snapshot returns 401; configured login returns admin role; real `/control/ws` WSS snapshot and clock round trip passed without allocating another audience identity |
| Working tree | `git diff --check` passed; reference code untouched; ignored configuration/footage excluded |

Logs: `runtime/local/gate-stage-dashboard.log`, `gate-stage-final-{sync,client,admin}.log`, `e2e-stage-dashboard.log`; generated E2E report is `.devcontext/evidence/integration/local-e2e.md`. The browser harness and its two production frontend processes were stopped after testing; temporary test tabs were closed. The app and named tunnel remain running.

## Handoff

Read `docs/stage-dashboard.md` and updated Cloudflare guide. UI work is ready for review/commit; no second commit/push was implied beyond the initial requested checkpoint. At the next normal stopped-session restart, load the final backend refinements. Rehearse actual iOS/Android sound-unlock behavior, video selection/upload on recording phones, projector scanning distance and near/far acoustic timing. Generated-video tests and desktop responsive emulation do not establish those physical results. Railway deployment remains deferred.
