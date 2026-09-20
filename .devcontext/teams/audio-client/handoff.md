# audio-client handoff

Latest: [music visualizer integration](../integration/journal/20260920-color-music-integration.md). The page uses MusicVisualizer with the existing ShowControl view and a disposable LevelMeter tap on AudioContextHost.masterGain. Preserve frame-time effective state, calibration/recovery/manual controls, the keepalive noise floor and analysis-only cleanup. No protocol or audio-engine API changes. Refresh audience pages, assign parts and play to test the feature; compare actual phones during rehearsal.

Main integration follow-up: [playback recovery journal](../integration/journal/20260920-playback-recovery.md) supersedes the historical readiness/timing details below. ShowControl callers must supply current `audioOutputReady` and call `refreshReadiness()` after clock/output changes; all source/lease updates are gated. See the linked decision for the internal API, two-second controls, checks and physical limitations.

Read [stage brief](../../stages/02-audio-client.md), root rules/masterplan and shared schema notes before changing code. Workflow: take the next slice from the stage brief, write a subplan under `plans/`, get it reviewed, then implement.

## Slice 4 (2026-09-19): channel playback, transport, mix, panic and lease

Subplan: [plans/04](plans/04-channel-playback.md). Status: ready for integration. A listening check is still pending.

Client behaviour:
- **Prepares.**
  - `assets.prepare` preloads the show and replies `assets.ready`, listing only verified hashes.
  - `assignment.prepare` (own device only) and `transport.prepare` reply ready, or not ready with `audio-locked`, `clock`, `show-mismatch` or `assets-missing`.
- **Commits.** `assignment.commit`, `transport.commit` and `mix.commit` apply at `effectiveServerMs`, strictly in revision order. A replacement in the same domain cancels the pending one; other domains are unaffected.
- **Late commands and joins.** A commit whose time has already passed, or a snapshot of a show that is already playing, rejoins at `now + 1000 ms` at the shared playhead.
- **Panic.** `panic` stops all sources and closes the output gate at once. After that, only a higher `transportRevision` can play.
- **Lease.** `lease.renew` holds an audio-clock gate open until `expiresServerMs`. Without a lease the phone is silent.
- **Snapshots.** `state.snapshot` rebuilds from `transport`, `assignment` and `pendingActions`. Master gain is the last one known this page load, or 1.0.
- **Clock.** Production has no clock yet, so it answers `reason: "clock"`. Mock mode uses the labelled fixture clock.

**Proposals for Team 1 (in addition to the slice 2 list):**
6. Send `lease.renew` right after the socket opens, then every few seconds. The mock uses every 3 s with a 10 s expiry.
7. After `panic`, move the snapshot's transport to a new stopped revision, as the mock does.
8. Carry the effective mix in the snapshot: [proposed ADR](../../decisions/20260919-120306-audio-client-mix-in-snapshot.md).

Checks run:
- `bun run gate:client`: PASS (103 tests).
  - Timeline maths and the engine run against a fake AudioContext that records start/stop and gain automation: crossfade at the switch time, pause/seek, superseded changes, panic, lease gate, missing tracks, mix.
  - `ShowControl` tests cover every prepare/commit rule.
  - A mock end-to-end test covers assign, play and a reconnect mid-song, which rebuilds the same playhead.
- Desktop Chrome (automation, audio locked):
  - Ready replies were all `audio-locked`, which is correct for a window that can't unlock audio.
  - The display showed "Switching to Melody in 2.3 s", then "Channel: Melody", then "Play in 2.3 s", then "Playing 0:01.6", "Paused at 0:03.4", "Paused at 0:06.0" (seek), "Playing 0:06.2" and "Muted by operator".
- Found and fixed while testing:
  - The display only refreshed while audio was running, so a phone without sound showed stale state. It now refreshes on its own.
  - A "play in 0.5 s" command waited for the 1 s late-join margin even when nothing was playing. That margin now only applies when joining something already sounding.
- Not verified: actual sound, which needs a person to listen. See the steps in the chat or in the mock README.

## Slice 3 (2026-09-19): calibration flash

Subplan: [plans/03](plans/03-calibration-flash.md). Status: ready for integration. One manual check is pending.

Client behaviour:
- `calibration.prepare`: ignored unless the session/epoch match and this device is in `participantIds`. Otherwise the client replies `calibration.ready` with `ready: false` and a reason (`opted-out`, `hidden` or `clock`), or `ready: true`. A later skip withdraws a yes with `ready: false, reason: "opted-out"`.
- `calibration.arm`: accepted only for the same `preparationId`, identical plan fields and `effectiveServerMs === run.startServerMs`. If it arrives at or after the start, the phone sends `calibration.result { completed: false, reason: "late" }` and never flashes.
- The flash colour is `palette.zero`/`one`/`neutral` of `calibrationPacket(deviceId, runTag)[floor((now - start) / 200)]`, using the pure server clock only. A skipped frame jumps straight to the right slot.
- Exactly one `calibration.result` per armed run: `completed: true` with `maxFrameLatenessMs` (a diagnostic, not display timing), or `completed: false` with `hidden`/`clock`/`disconnected`/`superseded`/`opted-out`. A result can be lost if the socket is already gone; the server should treat a missing result as not completed.
- Production has no clock yet, so it answers `reason: "clock"`. Mock mode uses the labelled local fixture clock.

For the captain / Team 1 / Team 4: [proposed ADR](../../decisions/20260919-113215-audio-client-manual-column.md) for a `participant.column` message so phones that skip can pick left/center/right.

For Team 3: the rendered packet matches `otc-golden-packets.json` for IDs 0, 1, 1023, 1024 and 2047 (test). No filmed clips yet; that needs phones on a reachable origin.

Checks run:
- `bun run gate:client`: PASS (71 tests), including an end-to-end prepare → ready → arm → result run against the mock.
- Desktop Chrome automation: Chrome reports the automation window as hidden and delivers zero animation frames there. The phone correctly answered `ready: false, reason: "hidden"` and did not flash.
- The user watched the flash in a visible desktop tab and confirmed it works (2026-09-19). The mock recorded `completed: true`, max frame lateness 8.6 ms.
- Unlock feedback: if `AudioContext.resume()` doesn't finish within 4 s (a tap the browser didn't accept as a gesture), the page shows "Sound didn't start. Tap the sound button again." Checked in the automation window, where resume hangs.

Manual check to do: `bun run dev:client-demo`, open http://localhost:3000 in a visible window, then `curl -X POST localhost:18081/__mock__/calibrate`. Expect: a countdown for about 2 s, then ~11 s of full-screen amber/blue flashing, then the page returns showing "Calibration: done". `curl localhost:18081/__mock__/calibration` shows `completed: true`. Switching tabs mid-flash should give `reason: "hidden"`. Warning: this is a flashing full-screen pattern.

## Slice 2 (2026-09-19): join, resume and connection

Subplan: [plans/02](plans/02-join-resume-connection.md). Status: ready for integration against Team 1's API.

What the client does now:
- `POST /api/sessions/:sessionId/join` with `{}` or `{ resumeToken }`. The token is stored in `localStorage` under `orchestra:resume:<sessionId>`.
- Opens `NEXT_PUBLIC_WS_URL?token=<resumeToken>`. It becomes "connected" only on a valid `state.snapshot` for its own device ID and session.
- Every reconnect resumes over HTTP first, then opens a new socket. A lower revision in the same epoch is ignored; a new epoch replaces state.
- Sends `device.status` (validated `ClientMessage`) on any readiness change, at most every 500 ms, and a fresh one after each reconnect.

**Proposals for Team 1 (not yet agreed; the client assumes them and the mock implements them):**
1. Socket auth is `?token=<resumeToken>` on the WebSocket URL. Unknown token → refuse the upgrade.
2. Join errors: 401 `INVALID_RESUME_TOKEN` for an unknown token (the client then rejoins as new), 409 `SESSION_FULL` at capacity (the client stops).
3. A second socket for the same identity closes the older one with code 4001 "replaced". The client does not auto-reconnect after 4001.
4. The server sends `state.snapshot` immediately on socket open.
5. `device.status.payload.deviceId` must match the socket identity; the mock closes with 1008 on mismatch.

Checks run:
- `bun run gate:client`: PASS (53 tests, including a real HTTP/WebSocket test against `tools/client-demo/server.ts`).
- Desktop Chrome with `bun run dev:client-demo`: joined as Device 0; reload kept Device 0; Enable sound → audio unlocked and 4/4 tracks verified, mirrored in `/__mock__/devices`; `/__mock__/drop` and `/__mock__/restart` each showed "Reconnecting (attempt 1)" then Connected as Device 0; a second tab took Device 0 and the first showed "Opened in another tab" and stayed stopped; clearing the token gave Device 1.
- Not observed: the foreground switch, because Chrome reported the automation window as hidden throughout. The page correctly reported `foreground: false`.

Test controls (mock only, loopback): `POST /__mock__/drop`, `POST /__mock__/restart`, `GET /__mock__/devices`.

## Slice 1 (2026-09-19): AudioContext, verified preload, scheduled start

Subplan: [plans/01](plans/01-audio-context-preload-click.md). Status: ready for integration. Physical checks are still outstanding.

Changed interfaces (all additive, `@orchestra/audio`):
- `AudioContextHost(create?)`: `context()`, `unlock()` (call from a gesture; rejects unless running), `masterGain`, `state`, `onStateChange()`, `dispose()`.
- `serverMsToAudioTime(clock, ctx, serverMs)` / `perfToAudioTime`: the only output-clock mapping. Never subtract `outputLatency` or a nudge elsewhere.
- `loadTrack(track, { ctx, budget, baseUrl, fetch? })` → `LoadedTrack`. Throws `AssetError` with `code` `http | size | hash | budget`. `DecodedBudget(limitBytes = 64 MB)`.
- `scheduleClick(ctx, output, buffer, clock, serverStartMs)` → `{ status: "scheduled", startAudioTime, cancel }` or `{ status: "late", lateBySeconds }`.
- `AudioEngine` interface is unchanged. `applySnapshot` is slice 4.

Checks run:
- `bun run gate:client`: PASS. Contracts, fixtures, boundaries, typecheck, lint, 18 tests (17 new in `packages/audio/tests`), client build.
- Desktop Chrome, mock on 18081 and Next on 3100 (port 3000 was busy locally): Enable sound → "tone-0 decoded, sha256 verified (1.54 MB decoded)". Play → "Tone scheduled at audio time 11.190 s (3 s ahead)". Pressing again cancelled and rescheduled. Audible output was not confirmed.

For the captain:
- `client-frontend/package.json` adds `@orchestra/audio` and `@orchestra/sync` workspace deps. `bun.lock` gains 2 workspace lines. `next.config.ts` transpiles both.
- `THIRD_PARTY_NOTICES.md`: one sentence now names the `packages/audio` extractions.

For Team 1: the client uses only `SynchronizedClock.toLocalPerformanceMs`. It expects `performance.now()`-domain ms (masterplan §4). The dev fixture clock in `client-frontend/src/lib/fixture-clock.ts` is to be replaced by the real estimator.

Next consumer action: listen to the desktop check, run it on iOS Safari and Android Chrome, then write subplan 02 (join/resume/protocol adapter).
