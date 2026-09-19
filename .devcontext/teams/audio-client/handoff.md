# audio-client handoff

Read [stage brief](../../stages/02-audio-client.md), root rules/masterplan and shared schema notes before changing code. Workflow: take the next slice from the stage brief, write a subplan under `plans/`, get it reviewed, then implement.

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
