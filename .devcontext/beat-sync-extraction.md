# BeatSync extraction provenance

Reference: supplied beatsync-source/ tree. The source files have not been edited. The upstream commit is not supplied; SHA-256 identifies the exact input. Full MIT notice is in THIRD_PARTY_NOTICES.md.

Only epochNow is extracted in the software foundation. Source NTP/audio tests and physical playback have not been run; characterization is a first Team 1/2 milestone, not a completed claim.

| Reference path | SHA-256 | Destination | Status |
| --- | --- | --- | --- |
| `packages/shared/utils.ts` | `76b46ea84d98f19ab87c8ed4eb54482f8eba8281a3d4a0592233e9bbcb373b63` | `packages/sync/src/index.ts` | epochNow extracted; other utilities omitted |
| `apps/client/src/utils/ntp.ts` | `40bef103bb563e8eddcdf8395d18d15bfbcd3eedef24f1e58110bfe634456341` | `packages/sync/` | pending Team 1 |
| `apps/client/src/hooks/useNtpHeartbeat.ts` | `d93ed71f383ace07f9ce0c1348bfc164587a3aec0ae4b96971655dbf3ee62cf0` | `packages/sync/ and client-frontend/` | pending Teams 1/2 |
| `apps/server/src/routes/websocketHandlers.ts` | `3520f3370c2c998d866272e92c636a7993e07d72f9a540496a496dc13aa0d3cd` | `backend/` | pending Team 1 |
| `apps/server/src/managers/RoomManager.ts` | `98cf0a0b4446727455571d1118d44f7619d41cc81e0fda1b351c4921f7c16b53` | `backend/` | pending Team 1 |
| `apps/client/src/lib/audioContextManager.ts` | `b71b602d6e655d9f9dc8f1381be25f13c68d7c4b82eeb4c5fd0dad0b42d9268a` | `packages/audio/src/context.ts`, `timing.ts` | extracted (Team 2 slice 1); see below |
| `apps/client/src/store/global.tsx` | `17a59a1b9135ab3091bb9045b7d5f06959535dbc2b19a1df4c9c25ad21b9998d` | `packages/audio/src/assets.ts`, `schedule.ts` | load/decode and scheduled start adapted (slice 1); multichannel playback pending |

The extracted epochNow behavior is unchanged: performance.timeOrigin + performance.now(). Its new test verifies independence from a Date.now wall-clock jump. The sync estimator/audio implementation and associated original tests remain to be ported according to masterplan.md.

## Team 2 slice 1 (2026-09-19)

Subplan: [teams/audio-client/plans/01](teams/audio-client/plans/01-audio-context-preload-click.md). Source hashes above were rechecked and are unchanged.

- `audioContextManager.ts` → `packages/audio/src/context.ts`. Kept: one reused context, resume from `suspended` and iOS `interrupted`, best-effort screen wake lock re-acquired on visibility, master gain. Changed: injected context factory instead of a module singleton; `unlock()` rejects unless the context is running. Dropped: low-pass filter, Bluetooth keepalive oscillator, logging, and the legacy iOS <16.4 silent-audio mute-switch bypass (user decision; iOS 16.4+ only).
- `audioContextManager.ts` `perfTimeToAudioTime` → `packages/audio/src/timing.ts`. Same `getOutputTimestamp()` mapping and `currentTime` fallback. It is the only output-clock method; `global.tsx`'s outputLatency filter and nudge subtraction are deliberately not ported.
- `global.tsx` fetch/decode and `playAudio` start → `packages/audio/src/assets.ts`, `schedule.ts`. Added SHA-256 and byte-size verification before decode. The three-buffer LRU is replaced by a decoded-byte budget (64 MB default). Past start times are refused instead of started late. Zustand/React state, playlist advance and toasts are not ported.
- Tests are new (`packages/audio/tests/audio.test.ts`). BeatSync has no tests for the context, output-clock or decode paths; `websocket/__tests__/dispatch.test.ts` only mocks `schedulePlay` for message routing, which belongs to slice 2.
