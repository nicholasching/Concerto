# Subplan 01: AudioContext, unlock, verified preload, scheduled click
Status: approved 2026-09-19 (user review)
Owner / branch / baseline SHA: Team 2 / feat/audio-client / foundation-v1 (ab59c27)
Source: masterplan §2 extraction map, §6 Team 2 step 1, "Timeline and timing semantics", "Media, memory, and network budgets". Stage brief 02 slice 1.

## Goal and acceptance criteria

- One AudioContext per page. It's created lazily, reused, and resumed from `suspended` or iOS `interrupted` only by a user gesture.
- A track loads as ready only after its bytes match the contract `sha256` and `byteSize` and it decodes. A mismatch fails and is never reported as ready.
- Decoded bytes are counted (`length × channels × 4`). A load that would exceed the budget is rejected.
- A click scheduled for server time `S` starts at the AudioContext time from one conversion: `clock.toLocalPerformanceMs(S)` then `getOutputTimestamp()` (or the `currentTime` fallback). No `outputLatency` or nudge is subtracted anywhere.
- A start time already in the past is refused (`late`). It never starts late locally.
- `bun run gate:client` passes with the new tests. There are no `beatsync-source` imports.

## Source extraction map

| BeatSync source | Kept | Changed or dropped |
| --- | --- | --- |
| `apps/client/src/lib/audioContextManager.ts` | reuse one context, `suspended`/`interrupted` resume, best-effort wake lock with visibility re-acquire, master gain, `perfTimeToAudioTime` mapping and fallback | not a module singleton (injected factory for tests). Low-pass filter, Bluetooth keepalive and console logging dropped. Legacy iOS silent-audio hack dropped (decision 1) |
| `apps/client/src/store/global.tsx` (load/decode, `schedulePlay`/`playAudio`) | fetch → `decodeAudioData`, `source.start(when, offset)` | hash/size verification added. 3-buffer LRU replaced with a decoded-byte budget. Output-latency and nudge subtraction dropped. Zustand/React removed |

## Files

- `packages/audio/src/context.ts`: `AudioContextHost` (`context()`, `unlock()`, `state`, `onStateChange`, `masterGain`, `dispose()`).
- `packages/audio/src/timing.ts`: `serverMsToAudioTime(clock, ctx, serverMs, nowPerfMs?)`.
- `packages/audio/src/assets.ts`: `loadTrack(track, { fetch, ctx, budget })` and `DecodedBudget`.
- `packages/audio/src/schedule.ts`: `scheduleClick(ctx, output, buffer, clock, serverStartMs)` → `{ status: "scheduled", cancel } | { status: "late" }`.
- `packages/audio/src/index.ts`: existing `AudioEngine` interface unchanged, plus re-exports.
- `packages/audio/tests/*.test.ts`: fake AudioContext and `FakeClock`.
- `client-frontend/src/app/page.tsx`: mock-only "Enable sound" / "Play click in 3 s" section with honest states.
- `client-frontend/package.json`, `next.config.ts`: `@orchestra/audio` workspace dep and `transpilePackages` (lockfile update, decision 3).
- Docs: `beat-sync-extraction.md` rows, Team 2 status/handoff/journal.

## Tests

1. Timing: offset sign with `FakeClock` offset, ms→s units, `getOutputTimestamp` path, fallback when it returns zeros, and `outputLatency` set to 0.2 s changes nothing.
2. Context: repeated `context()`/`unlock()` returns one instance. Resume is called for `suspended` and `interrupted`, and not for `running`.
3. Assets: real `fixtures/media/tone-0.wav` passes. One flipped byte fails with a hash error. Wrong size fails. A failed load leaves the budget unchanged.
4. Budget: accounting matches `length × channels × 4`, and an over-budget load is rejected.
5. Schedule: a future start calls `start(expectedAudioTime)`, a past start returns `late` without `start`, and `cancel()` stops the source.

## Verification

- `bun run gate:client` and `bun run check:boundaries`.
- Manual desktop Chrome: `bun run dev:client-demo` → `localhost:3000` → Enable sound → "decoded, hash verified" → click heard at countdown. Recorded as a desktop browser check only.
- Still unverified after this slice: iOS/Android phones, two-phone sync (needs Team 1 estimator), acoustic onset.

## Review decisions (2026-09-19)

1. Legacy iOS <16.4 silent-audio hack: dropped. Noted in provenance.
2. Decoded-byte budget: 64 MB.
3. `@orchestra/audio` added to `client-frontend` now, with the demo. The `bun.lock` change is flagged for captain review in the handoff.
