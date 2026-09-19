# BeatSync extraction provenance

Reference: supplied beatsync-source/ tree. The source files have not been edited. The upstream commit is not supplied; SHA-256 identifies the exact input. Full MIT notice is in THIRD_PARTY_NOTICES.md.

The clock estimator and audio engine are extracted. The source's own two-device physical
playback baseline has not been reproduced, so timing characterization is still an open Team 1/2
milestone rather than a completed claim.

| Reference path | SHA-256 | Destination | Status |
| --- | --- | --- | --- |
| `packages/shared/utils.ts` | `76b46ea84d98f19ab87c8ed4eb54482f8eba8281a3d4a0592233e9bbcb373b63` | `packages/sync/src/epoch.ts` | epochNow extracted; other utilities omitted |
| `apps/client/src/utils/ntp.ts` | `40bef103bb563e8eddcdf8395d18d15bfbcd3eedef24f1e58110bfe634456341` | `packages/sync/src/estimator.ts` | coded probe pairing and min-RTT selection extracted |
| `apps/client/src/utils/__tests__/ntp.test.ts` | `f5f0dd74ff0d12f2b7845d0eaea84d72a1f822500d1ea134cc9a9727d6c28fa9` | `packages/sync/tests/estimator.test.ts` | min-RTT and wait-time cases ported |
| `apps/server/src/__tests__/codedProbes.test.ts` | `7bfd4f29296714442f389512c51a62eae8c07a8051e21054ab7bcdc1cd86fefe` | `packages/sync/tests/estimator.test.ts` | gap-purity cases ported |
| `packages/shared/constants.ts` | `cf9cd4bea25cc9fb7c3b6541ab640c9fa7ed3d00b3d76530150abdcd5889818d` | `packages/sync/src/estimator.ts` | NTP_CONSTANTS values retained as PROBE_CONSTANTS |
| `apps/client/src/store/global.tsx` | `17a59a1b9135ab3091bb9045b7d5f06959535dbc2b19a1df4c9c25ad21b9998d` | `packages/sync/ (window rule), packages/audio/ and client-frontend/` | sliding-window and readiness-count rule extracted; audio/store pending Team 2 |
| `apps/client/src/hooks/useNtpHeartbeat.ts` | `d93ed71f383ace07f9ce0c1348bfc164587a3aec0ae4b96971655dbf3ee62cf0` | `packages/sync/ and client-frontend/` | intervals retained as `nextProbeDelayMs()`; React timer/staleness handling pending Team 2 |
| `apps/server/src/routes/websocketHandlers.ts` | `3520f3370c2c998d866272e92c636a7993e07d72f9a540496a496dc13aa0d3cd` | `backend/` | pending Team 1 |
| `apps/server/src/managers/RoomManager.ts` | `98cf0a0b4446727455571d1118d44f7619d41cc81e0fda1b351c4921f7c16b53` | `backend/` | pending Team 1 |
| `apps/client/src/lib/audioContextManager.ts` | `b71b602d6e655d9f9dc8f1381be25f13c68d7c4b82eeb4c5fd0dad0b42d9268a` | `packages/audio/src/context.ts`, `timing.ts` | extracted (Team 2 slice 1); see below |
| `apps/client/src/hooks/useWebSocketReconnection.ts` | `582b1cd3a411fef1bf64bd86693797d6d4df0a1bcdd4ed8e7635bf920a06dfe8` | `client-frontend/src/lib/connection.ts` | backoff/timeout/wake reconnect adapted (Team 2 slice 2); see below |
| `apps/client/src/store/global.tsx` | `17a59a1b9135ab3091bb9045b7d5f06959535dbc2b19a1df4c9c25ad21b9998d` | `packages/audio/src/assets.ts`, `schedule.ts` | load/decode and scheduled start adapted (slice 1); multichannel playback pending |

The extracted epochNow behavior is unchanged: performance.timeOrigin + performance.now(). Its new test verifies independence from a Date.now wall-clock jump.

## Clock estimator: retained behavior

Offset `((t1 - t0) + (t2 - t3)) / 2` and round-trip `(t3 - t0) - (t2 - t1)`; coded probe pairs
validated by comparing the client inter-departure gap with the server inter-arrival gap within
`PROBE_GAP_TOLERANCE_MS`; the lower-RTT member of an accepted pair is kept; offset selected from
the minimum-RTT sample in a sliding window; probe gap 25 ms, tolerance 5 ms, window 16, reprobe
intervals 50 ms then 2500 ms, response timeout 3750 ms.

## Clock estimator: deliberate differences

| Difference | Reason |
| --- | --- |
| Module-level probe state becomes per-instance state on `ClockEstimator` | One process runs many independent estimators (simulated clients in the load harness); a pair from one client must not contaminate another |
| Direct `epochNow()` calls become an injected `now()` | Deterministic tests without wall-clock dependence, as rules section 10 requires |
| Per-pair `console.log` removed; counters exposed through `stats()` | The estimator runs on the hot path for every probe |
| `calculateOffsetEstimate` renamed `selectMinRttOffset`, returning `offsetMs`/`minRoundTripMs`/`averageRoundTripMs` | The source returned the min-RTT offset under the name `averageOffset`; the new name states what it computes and the unit suffixes are mandatory at clock boundaries |
| `serverEpoch` tracked; a reply carrying a new epoch clears all measurements | Masterplan section 4: an epoch change invalidates prior timing. BeatSync has no epoch concept |
| Probe group counter never restarts, including across `reset()` | A reply that outlives a reconnect cannot match a newly issued group ID |
| Readiness is recomputed rather than latched: it requires the measurement count, an uncertainty at or below 20 ms, and a sample age within the response timeout | The source latched `isSynced` once 16 measurements existed; masterplan section 6 requires an eligibility threshold and sample age that can degrade |
| `useNtpHeartbeat` not ported; only its intervals survive, as `nextProbeDelayMs()` | The hook is React-bound. Timer ownership, jitter and staleness handling belong to the client and the load harness |

## Team 2 slice 1 (2026-09-19)

Subplan: [teams/audio-client/plans/01](teams/audio-client/plans/01-audio-context-preload-click.md). Source hashes above were rechecked and are unchanged.

- `audioContextManager.ts` → `packages/audio/src/context.ts`. Kept: one reused context, resume from `suspended` and iOS `interrupted`, best-effort screen wake lock re-acquired on visibility, master gain. Changed: injected context factory instead of a module singleton; `unlock()` rejects unless the context is running. Dropped: low-pass filter, Bluetooth keepalive oscillator, logging, and the legacy iOS <16.4 silent-audio mute-switch bypass (user decision; iOS 16.4+ only).
- `audioContextManager.ts` `perfTimeToAudioTime` → `packages/audio/src/timing.ts`. Same `getOutputTimestamp()` mapping and `currentTime` fallback. It is the only output-clock method; `global.tsx`'s outputLatency filter and nudge subtraction are deliberately not ported.
- `global.tsx` fetch/decode and `playAudio` start → `packages/audio/src/assets.ts`, `schedule.ts`. Added SHA-256 and byte-size verification before decode. The three-buffer LRU is replaced by a decoded-byte budget (64 MB default). Past start times are refused instead of started late. Zustand/React state, playlist advance and toasts are not ported.
- Tests are new (`packages/audio/tests/audio.test.ts`). BeatSync has no tests for the context, output-clock or decode paths; `websocket/__tests__/dispatch.test.ts` only mocks `schedulePlay` for message routing, which belongs to slice 2.

## Team 2 slice 2 (2026-09-19)

Subplan: [teams/audio-client/plans/02](teams/audio-client/plans/02-join-resume-connection.md). Source hashes were rechecked and are unchanged.

- `useWebSocketReconnection.ts` → `client-frontend/src/lib/connection.ts`. Kept: 1 s initial delay, ×1.1 growth, 10 s cap, up to 15% jitter, 15-attempt limit, 5 s connect timeout for Safari's silent drops, and immediate reconnect on visibility/online with a fresh attempt budget. Changed: a plain class with injected timers and socket instead of React refs and the Zustand store; each reconnect re-resumes identity over HTTP before opening the socket; a "replaced" close stops reconnecting.
- `websocket/dispatch.ts` (sha256 `5b4c97a0430907756cf904eb6b13b96be4e946882d8b1284857a97f44c92c963`): not copied. Messages are validated with the shared `ServerMessage` schema and handled by type.
