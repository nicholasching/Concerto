# Local integrated concert handoff

Latest UI (2026-09-20): [Concerto metal design and verification](journal/20260920-concerto-metal-ui.md). Refresh `/` and `/present`; audience copy is minimal with expandable readiness details. Product branding is updated across the four routes. Client/admin gates and production smoke pass; real-phone/QR-distance checks remain separate. No live backend restart or saved-show change was required.

Latest (2026-09-20): [automatic four-section routing and show-save recovery](journal/20260920-automatic-audience-sections.md). Reviewed calibration now applies balanced Left / Center left / Center right / Right membership and saved section-to-music presets automatically. Step 02 shows the resulting groups. Camera columns remain three. Live supervisor is PID 41364 (`bun scripts/dev.ts all`); logs are `runtime/branch-restart-20260920/app-sections.*.log`. The updated backend is active and the user's three-stem show saved successfully at revision 4. Earlier process IDs below are historical. Refresh participant pages after this schema update. Prior [128 MiB upload proxy fix](journal/20260920-percussion-upload-diagnosis.md) is preserved. All three affected JS gates pass; physical four-section/audio checks remain outstanding.

OTC update (2026-09-20): local backend and both Next apps restarted at 03:50:58 with v2 (250 ms symbols, no optical tag). Persistent show/map/assignments/device IDs are verified unchanged and public routing reaches the new epoch. Wider detection recovers the latest physical six-phone clip 6/6. See [checks, runtime ownership and fresh-recording handoff](../otc-localization/journal/20260920-tolerant-detection.md). The active hidden supervisor is `runtime/otc-six-phone-investigation/run-services.ts`; its app logs are in that ignored directory. The tunnel is unchanged. Refresh phones/admin before a fresh calibration.

Latest: [manual section routing](journal/20260920-manual-section-routing.md), after the pushed playback checkpoint **a29625e**. Fallback phones automatically receive section music, follow section assignments until explicitly overridden, and join running playback after readiness checks. Defaults are left/Melody, center/Vocals, right/Percussion; section evidence remains manual/coarse. No wire/schema regeneration required; checkpoint v3 has an optional automatic-routing ownership list.

Latest playback follow-up: **cb271b1** checkpoint pushed first. Read [two-second controls and playback recovery](journal/20260920-playback-recovery.md) for code causes, checks, runtime updates and remaining physical phone verification.

Latest: [five-phone positioning follow-up](journal/20260919-five-phone-positioning.md). UI checkpoint eb274b3 is pushed. New uploads automatically map with a declared stage-facing frame layout; decoder v1.6 accepts valid non-colliding IDs with disclosed tracking/repeat warnings. All five phones in the supplied PXL clip are verified, including console click/box selection in an isolated physical-result review. Existing committed live map/assignments are preserved; old jobs do not change retrospectively. Refresh pages and run a new calibration to use the new backend/frontend metadata. See the journal for exact gate evidence and live runtime state.

Date: 2026-09-19. Owner: captain. Current implementation: main after the four feature merges.

Latest mapping update: the four-device recording now plots IDs 14/15/17/21 and is committed as map revision 10. The live Assign console supports click, box/lasso and movable left/center/right dividers, verified with a 2/1/1 split. Calibration geometry is restored from uploaded metadata and editable using a completed job's preview; processing saves dirty edits. Stage-facing full-frame anchors are an explicit approximate preset, not measured seats. See the [operator guide](../../../docs/audience-mapping.md) and [verification/handoff journal](journal/20260919-seat-map-selection.md). Decoder behavior and musical assignments are unchanged; current mapping is later than the historical two-device uncommitted sample below.

Current user updates: shows now use **Melody, Vocals and Percussion** with a shared **512 MiB decoded-audio budget per phone**. The live show has been saved with six tracks/clips, approximately 304.1 MiB, preserving device routing and uploaded audio. All three JS gates and the real-worker E2E pass; public desktop-browser loading verifies 6/6 assets. See [three-channel handoff](journal/20260919-three-channels.md) and [budget evidence](journal/20260919-decoded-audio-budget.md). Older phone pages need refreshing for the larger budget. Historical four-channel references below describe the previous checkpoint.

## Run

From the root, `bun install --frozen-lockfile`, `bun run setup:python`, then `bun run dev:all`. In a second terminal, `bun run demo:seed` only if no show exists. This uploads three original eight-second tones, not bundled third-party music. Local state/media are in ignored `runtime/local/` and are preserved across restarts. Current workflow: [stage guide](../../../docs/stage-dashboard.md) and [UI verification journal](journal/20260919-stage-dashboard.md).

- Operator: `http://localhost:3000/admin`, password from ignored `.env` (`OPERATOR_SECRET`). The local configured password intentionally differs from the unconfigured development default.
- Participant: `http://localhost:3000/?session=dev-session`.
- Projector: `http://localhost:3000/present`; camera crew: `http://localhost:3000/upload`.
- Backend: `http://localhost:8080`.
- This machine has Bun at `.tools/bun-1.3.14/bun-windows-x64/bun.exe` if it is absent from PATH. Python dependencies are in `.venv/`.

For other devices, follow [Cloudflare setup](../../../docs/cloudflare-tunnel.md). Node 22+ runs Next; Bun runs the backend. One tunnel to port 3000 serves all four pages. Open `/present` on the public hostname for its QR, or configure `NEXT_PUBLIC_PARTICIPANT_URL` before starting/building. Operator routes authenticate under `/control`; camera crew use limited tokens and small resumable chunks. The [workflow ADR](../../decisions/20260919-single-domain-stage-workflow.md) supersedes the earlier local-only-admin design.

Phones automatically join, sync and verify music. Sound is attempted automatically; tap once only if the browser requires it. Keep the page visible. After calibration, mapped phones display their section and unlocated phones choose a manual section. Assign musical parts in the console, prepare the cue, inspect readiness and start the show. The original fixture tones end at eight seconds; the shared timeline continues until stopped. Edit stems through Performance → Prepare show and stems.

Calibration: prepare all ready phones or explicit target IDs, start three cameras, arm, wait for the eleven-second pattern and trailing margin. Upload original clips, label column/rotation, set four ordered seating anchors or keep a coarse map, and process. Review decoded stills, camera contributions, map status/ID filters and unresolved evidence before committing. Geometry edits or late interrupted-pattern reports invalidate old candidates. Synthetic video must stay labeled synthetic. Failed jobs can be cancelled/retried; discard releases an unusable run.

For a one-camera test, select only that upload with its **Include Camera** checkbox. The console rejects selecting identical video hashes as multiple views. Decoder v1.4 now recovers two IDs (9 and 11) from the user's original sample; the console reports decoded devices separately from seat coordinates. See [physical evidence](../otc-localization/journal/20260919-two-physical-screens.md). The two coarse results are left open for review with no map commit. All five branches were pushed before this follow-up; teammates should fetch and merge origin/main for current integrated changes.

## Boundaries and recovery

- One authoritative backend. Operator credentials are separate from participant resume tokens. Operator JSON mutations serialize; streams and worker CPU stay outside the command queue.
- Shared ClockSync owns probe pairing, jitter, retries and epoch reset. UI receipt time is not a clock. Web Audio schedules output; timers only maintain queues.
- Live assignment prepares the exact selected IDs/channel/revisions; it preserves the common playhead and reports exclusions. Stopped routing may be saved for offline phones. No unknown coordinates are fabricated.
- Domain revisions supersede only their domain. Telemetry snapshots do not reload audio. Panic cancels future audio/routing and persisted assignment intents; lease loss silences disconnected phones.
- Restart restores identity/show/map/routing but changes epoch and stays stopped. Repeat unfinished calibration. Show edits require stopped transport.
- BeatSync is an untouched reference; attribution/provenance remain in the repository. The complete app runs from a source copy omitting that directory.

## Verification and next milestone

Use `bun run gate`, `bun run test:smoke`, `bun run test:e2e`, `bun run test:load`, and `bun run check:isolation`. Load defaults to 1500 sockets for 300 seconds; it uses synthetic worker contention. E2E uses real MP4 bytes and the real decoder, but generated scenes and a recording audio double. See [verification](../../evidence/integration/verification.md), not the historical foundation notes, for current results.

After the user's local review: choose demo stems, test iOS/Android audio and screen capture with real cameras, measure near/far-seat optical and acoustic behavior, then configure Railway persistence, HTTPS/WSS, public frontend URLs and operator credentials. Actual phones need a reachable address; their localhost is not this computer. Complete three rehearsals/fallback drills before claiming the masterplan's physical demonstration acceptance or tagging a demo build. Remote branches are published; Railway deployment remains deferred.
