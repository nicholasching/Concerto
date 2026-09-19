# audio-client handoff

Read [stage brief](../../stages/02-audio-client.md), root rules/masterplan and shared schema notes before changing code. Workflow: take the next slice from the stage brief, write a subplan under `plans/`, get it reviewed, then implement.

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
