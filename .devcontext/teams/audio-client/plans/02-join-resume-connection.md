# Subplan 02: join, resume and connection
Status: implemented 2026-09-19; ready for integration (see status.md)
Owner / branch / baseline: Team 2 / feat/audio-client / c03cb5b (slice 1)
Source: masterplan §4 "Identity, time, and state" and "Minimum HTTP and WebSocket surface", §6 Team 2 step 2. Stage brief 02 slice 2.

## Goal

A phone opens the participant page, gets a device ID, and keeps it across reloads and reconnects. It shows honest, separate readiness and reports it to the server. No other branch is needed: Team 2's own mock in `tools/client-demo/` stands in for the backend.

## Acceptance criteria

1. **Join.** On first open the page calls `POST /api/sessions/:sessionId/join` with `{}` and gets a `JoinResponse` (device ID, resume token, epoch, revision). It shows "Device N". ID 0 works like any other ID.
2. **Resume.** The token is saved per session in `localStorage`. A reload sends `{ resumeToken }` and gets the same device ID. A fresh browser profile with no token gets a new ID.
3. **Bad token.** If the server rejects the token, the page drops it, joins as a new device and says so. It never guesses or reuses an ID number.
4. **Capacity.** A join rejected for capacity shows "Session full" and doesn't retry in a loop.
5. **Socket.** After joining, the page opens the WebSocket with its token. The first message it must receive is a `state.snapshot` for its own device ID. Anything that fails `ServerMessage` validation is dropped and logged, not applied.
6. **Stale state.** In the same `serverEpoch`, a snapshot with a lower `revision` than the current one is ignored. A new `serverEpoch` (server restart) resets local state and replaces it with the new snapshot.
7. **Reconnect.** When the socket drops, the page shows "Reconnecting (attempt n)" and retries with BeatSync's backoff. It reconnects straight away when the tab becomes visible again or the network comes back. After the attempt limit it shows "Tap to reconnect". On reconnect it always takes the fresh snapshot rather than the old one.
8. **Replaced connection.** If the same identity connects from another tab, the server closes the old socket with a "replaced" code. The old tab shows "Opened in another tab" and doesn't auto-reconnect, so two tabs can't fight.
9. **Readiness.** The page shows five separate states: connected, clock ready, foreground, audio unlocked, and assets verified. A change sends one validated `device.status`, rate-limited to at most one every 500 ms. The page never marks audio ready from a socket connection alone.
10. **Assets.** After audio is unlocked, the page preloads every track in the snapshot's show with slice 1's `loadTrack`. It reports only verified hashes in `decodedTrackHashes`.
11. **Interruption.** If the AudioContext becomes `suspended` or `interrupted`, "audio unlocked" goes false and a visible "Tap to resume" appears. Hiding the page marks foreground false.
12. **Clock stays honest.** The production path has no clock yet. It reports `clockReady: false` until Team 1's estimator is wired in. The dev fixture clock stays confined to the slice 1 audio check.

## Design

The page logic is plain TypeScript classes with injected fetch, socket, timers and storage, so it can be tested without a browser. React only renders their state.

- `client-frontend/src/lib/join.ts`: `joinSession(api, sessionId, storage, fetch)`. It handles join/resume, bad-token fallback and capacity. It validates with `JoinRequest`/`JoinResponse`/`ApiError`.
- `client-frontend/src/lib/connection.ts`: `ParticipantConnection`. It owns the socket lifecycle, backoff, wake-up reconnect, snapshot acceptance (epoch and revision rules) and the replaced-connection stop. It emits `{ status, snapshot }`. The backoff numbers come from BeatSync `useWebSocketReconnection.ts` (1 s initial, ×1.1 per attempt, 10 s max, up to 15% jitter, 15 attempts, 5 s connect timeout), without React or Zustand.
- `client-frontend/src/lib/readiness.ts`: builds `DeviceReadiness` from connection, clock quality, `document.visibilityState`, AudioContext state and loaded hashes. It rate-limits `device.status` sends.
- `client-frontend/src/app/page.tsx`: the real participant flow. Join → status panel → "Enable sound" → preload → readiness. There are "Tap to resume" and "Tap to reconnect" buttons. When mocks are on, a "SYNTHETIC MOCK" label shows and the slice 1 audio check stays below.
- `client-frontend/src/lib/status.ts`: `participantStatus` gains the new states. Its existing test is updated and not weakened.

## Mock scenario (`tools/client-demo/`, Team 2-owned)

`startMockServer` in testkit returns 501 for join, and testkit is captain-owned. So `tools/client-demo/index.ts` gets its own small Bun server on 18081. It reuses testkit's `createDemoSnapshot`/`participantSnapshot` and the same asset route. No testkit change.

- `POST /api/sessions/demo/join`: allocates IDs 0, 1, 2… and never reuses them. Tokens are random, at least 32 characters. Resume returns the same ID, a bad token gets 401 `ApiError`, and past the configured capacity it's 409.
- `WS /ws?token=…`: an unknown token is refused. On open it sends that device's snapshot, and a second socket for the same token closes the first with code 4001 "replaced". It answers clock probes like the shared mock. It validates `device.status`, checks its `deviceId` against the socket's identity, and closes on mismatch. It prints the latest readiness per device.
- Test controls, loopback only: `POST /__mock__/drop` (close all sockets and keep identities), `POST /__mock__/restart` (new epoch, keep identities, like a checkpointed restart) and `GET /__mock__/devices`.

The mock stays labelled synthetic and is never imported by `client-frontend/src`.

## Tests (`client-frontend/tests/`, already in `gate:client`)

- join: new join, resume keeps the ID, bad token → drop token and rejoin, capacity → no retry, ID 0, responses validated
- connection, with fake socket and timers:
  - first snapshot applied
  - lower revision ignored
  - new epoch resets
  - invalid message dropped
  - backoff delays and attempt limit
  - visibility/online reconnect now
  - code 4001 stops reconnecting
- readiness: socket connected alone ≠ audio ready, interrupted context clears unlocked, only verified hashes reported, rate limit coalesces bursts
- mock scenario: a small Bun test that starts the tools/client-demo server on a random port and checks join/resume/replace/restart. This proves the mock behaves as the tests assume. It lives in `client-frontend/tests` and imports the tool, so no gate change is needed.

## Verification

- `bun run gate:client`.
- Browser walkthrough with `bun run dev:client-demo`:
  - join
  - reload keeps the ID
  - private window gets a new ID
  - duplicate tab shows "Opened in another tab"
  - `curl -X POST localhost:18081/__mock__/drop` → Reconnecting → back with the same ID
  - `/__mock__/restart` → new epoch accepted
  - Enable sound → four tracks verified
  - switch tabs → foreground false
  - `/__mock__/devices` shows the reported readiness
- Unverified after this slice: real backend, real clock, phones over a reachable HTTPS origin.

## BeatSync provenance

- `apps/client/src/hooks/useWebSocketReconnection.ts` (sha256 `582b1cd3…06dfe8`): backoff constants, the Safari silent-drop connect timeout and wake-up reconnect are adapted into `connection.ts`. React refs and the global store are dropped.
- `apps/client/src/websocket/dispatch.ts`: only the idea of a handler keyed by message type is used. No code is copied.

## Review decisions (2026-09-19)

1. Socket auth: `?token=<resumeToken>` in our mock, isolated in one function. Recorded as a proposal in the Team 1 handoff, no ADR yet.
2. Bad token: drop it, rejoin as a new device, and show a notice.
3. Preload: all show tracks are preloaded in this slice, after Enable sound.
4. Mock test: lives in `client-frontend/tests`. No `scripts/gate.ts` change.
