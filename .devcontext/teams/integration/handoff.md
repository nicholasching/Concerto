# Local integrated concert handoff

Date: 2026-09-19. Owner: captain. Current implementation: main after the four feature merges.

Latest mapping update: the four-device recording now plots IDs 14/15/17/21 and is committed as map revision 10. The live Assign console supports click, box/lasso and movable left/center/right dividers, verified with a 2/1/1 split. Calibration geometry is restored from uploaded metadata and editable using a completed job's preview; processing saves dirty edits. Stage-facing full-frame anchors are an explicit approximate preset, not measured seats. See the [operator guide](../../../docs/audience-mapping.md) and [verification/handoff journal](journal/20260919-seat-map-selection.md). Decoder behavior and musical assignments are unchanged; current mapping is later than the historical two-device uncommitted sample below.

Current user updates: shows now use **Melody, Vocals and Percussion** with a shared **512 MiB decoded-audio budget per phone**. The live show has been saved with six tracks/clips, approximately 304.1 MiB, preserving device routing and uploaded audio. All three JS gates and the real-worker E2E pass; public desktop-browser loading verifies 6/6 assets. See [three-channel handoff](journal/20260919-three-channels.md) and [budget evidence](journal/20260919-decoded-audio-budget.md). Older phone pages need refreshing for the larger budget. Historical four-channel references below describe the previous checkpoint.

## Run

From the root, `bun install --frozen-lockfile`, `bun run setup:python`, then `bun run dev:all`. In a second terminal, `bun run demo:seed` only if no show exists. This uploads four original eight-second tones, not bundled third-party music. Local state/media are in ignored `runtime/local/` and are preserved across restarts.

- Operator: `http://localhost:3001`, development secret `local-demo-only` (override `OPERATOR_SECRET`).
- Participant: `http://localhost:3000/?session=dev-session`.
- Backend: `http://localhost:8080`.
- This machine has Bun at `.tools/bun-1.3.14/bun-windows-x64/bun.exe` if it is absent from PATH. Python dependencies are in `.venv/`.

For other devices, follow [Cloudflare setup](../../../docs/cloudflare-tunnel.md). Node 22+ now runs Next so its external WebSocket rewrites work; Bun still runs the backend. Start `bun run tunnel:quick`, paste its HTTPS URL into the console's Participant link and select Use participant link. The audience uses the public origin for join/snapshot/audio/WSS; operator and uploads stay local. Run `bun run check:tunnel -- <public-origin>` for transport evidence. The public link is saved per console browser/session; a new Quick Tunnel URL requires updating it. See the [tunnel verification journal](journal/20260919-cloudflare-testing.md).

Tap Enable sound on the participant and keep it visible. Select a manual column, then assign a channel from the console. Prepare the cue, inspect readiness and play the ready subset. The tones end at eight seconds; the shared timeline continues until stopped. Test with your prepared stems through Perform → Prepare show and stems.

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
