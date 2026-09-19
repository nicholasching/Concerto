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
| `apps/client/src/lib/audioContextManager.ts` | `b71b602d6e655d9f9dc8f1381be25f13c68d7c4b82eeb4c5fd0dad0b42d9268a` | `packages/audio/` | pending Team 2 |
| `apps/client/src/store/global.tsx` | `17a59a1b9135ab3091bb9045b7d5f06959535dbc2b19a1df4c9c25ad21b9998d` | `packages/audio/ and client-frontend/` | pending Team 2 |

The extracted epochNow behavior is unchanged: performance.timeOrigin + performance.now(). Its new test verifies independence from a Date.now wall-clock jump. The sync estimator/audio implementation and associated original tests remain to be ported according to masterplan.md.
