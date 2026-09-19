# BeatSync extraction provenance

Reference: supplied beatsync-source/ tree. The source files have not been edited. The upstream commit is not supplied; SHA-256 identifies the exact input. Full MIT notice is in THIRD_PARTY_NOTICES.md.

The clock estimator is extracted; audio remains pending. The source's own two-device physical
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
| `apps/client/src/lib/audioContextManager.ts` | `b71b602d6e655d9f9dc8f1381be25f13c68d7c4b82eeb4c5fd0dad0b42d9268a` | `packages/audio/` | pending Team 2 |
| `apps/client/src/store/global.tsx` | `17a59a1b9135ab3091bb9045b7d5f06959535dbc2b19a1df4c9c25ad21b9998d` | `packages/audio/ and client-frontend/` | pending Team 2 |

The extracted epochNow behavior is unchanged: performance.timeOrigin + performance.now(). Its new test verifies independence from a Date.now wall-clock jump. The audio implementation and its original tests remain to be ported according to masterplan.md.

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
