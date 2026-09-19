# Subplan 03: calibration flash renderer
Status: implemented 2026-09-19; ready for integration (visible-browser flash check pending, see status.md)
Owner / branch / baseline: Team 2 / feat/audio-client / 45625bc (slice 2)
Source: masterplan §5.2 (packet v1), §5.3 (client and server sequence), §6 Team 2 step 3. Stage brief 02 slice 3. Contracts: `packages/contracts/src/otc.ts` (`calibrationPacket`, `SYMBOL_MS`, `PACKET_SYMBOLS`), `CalibrationPlan`/`CalibrationRun`, messages `calibration.prepare`/`arm`/`ready`/`result`.

## Goal

During a scheduled calibration the phone's whole screen flashes its own 55-symbol ID packet. Each symbol lasts 200 ms, and the timing comes from the pure server clock. Team 3's cameras can then decode which phone is where. The phone never flashes late, never flashes the wrong run, and says honestly when it couldn't take part. All of this works against Team 2's mock, with no other branch needed.

## Flow on the phone

1. **Prepare.** The server sends `calibration.prepare` with a frozen `CalibrationPlan`. The phone checks it:
   - the plan is for this session and epoch
   - this device is in `participantIds`
   - the page is in the foreground
   - the clock is usable
   - the user hasn't opted out

   It replies `calibration.ready` with `ready: true`, or `ready: false` plus a reason. A newer prepare replaces an older one.
2. **Arm.** `calibration.arm` carries the `CalibrationRun` with `startServerMs`. It is accepted only if its `preparationId`, `runId`, `runTag` and plan match the prepare this phone said yes to. Otherwise it's ignored.
3. **Countdown.** A full-screen neutral overlay appears with "Hold your phone up, screen toward the stage cameras" and a countdown. The text disappears 1 s before the start, leaving plain neutral.
4. **Flash.** On every animation frame: `slot = floor((clock.nowServerMs() - startServerMs) / symbolMs)`. The screen colour is `palette.zero`, `palette.one` or `palette.neutral` (for the `null` guard symbols) of `calibrationPacket(deviceId, runTag)[slot]`. The colour is written straight to one DOM element, with no React state per frame. A skipped frame just jumps to the correct slot, so later symbols never shift.
5. **Finish.** After slot 54 the overlay closes and the phone sends `calibration.result` with `completed: true`. That message includes `maxFrameLatenessMs`: the worst delay between a slot boundary and the first frame that drew it. This is a diagnostic only, not proof of what the screen physically showed.
6. **Abort, never late.**
   - If the phone receives the arm after `startServerMs`, it doesn't flash at all.
   - If the page is hidden mid-run, it stops.
   - If the clock becomes unusable, the connection drops, or the epoch changes, it stops.
   - If a newer prepare arrives, it stops.

   In every case it sends `calibration.result` with `completed: false` and a reason (`late`, `hidden`, `clock`, `disconnected`, `superseded`), and never restarts the packet.
7. **Skip.** A visible "Skip calibration" button sets opt-out. Later prepares are answered `ready: false, reason: "opted-out"`, and an active run stops. The manual column choice waits for a contract change (decision 2).

## Acceptance criteria

- The rendered symbol sequence for IDs 0, 1, 1023 and 2047 matches `otc-golden-packets.json`, sampled at each slot's midpoint.
- A skipped run of frames (for example no frame from slot 3 to slot 10) renders slot 10's colour next, and every later slot is unchanged.
- The first colour appears only at `startServerMs`. Nothing before it except neutral or the countdown text.
- Each abort case above produces exactly one `calibration.result` with the right reason, and no packet colour after the abort.
- A prepare for another device set, session or epoch gets no ready and no flash. A stale arm is ignored.
- The renderer uses only `SynchronizedClock`. It has no audio-clock or output-latency adjustment (masterplan §2, "Only pure clock offset belongs in optical timing").
- `bun run gate:client` passes.

## Design

- `client-frontend/src/lib/calibration.ts`: pure logic, no DOM. It covers:
  - `slotAt(nowServerMs, startServerMs, symbolMs)`
  - `symbolColor(symbol, palette)`
  - `CalibrationSession`: a small state machine (`idle → prepared → armed → flashing → done/aborted`) that turns prepare/arm/visibility/clock/opt-out events into ready/result messages
- `client-frontend/src/lib/flash-renderer.ts`: `FlashRenderer`, with an injected `requestAnimationFrame`, clock and a `paint(color)` callback. It runs the per-frame loop, tracks max lateness, and stops on abort.
- `client-frontend/src/app/calibration-overlay.tsx`: a fixed full-viewport element. React mounts it once, and the renderer paints its background directly. It has the countdown text and the Skip button.
- `client-frontend/src/lib/connection.ts`: add an `onMessage` hook so calibration messages reach the page. The snapshot handling stays as it is.
- `page.tsx`: wires the session to the connection. It requests a screen wake lock at arm time (best-effort, reusing slice 1's approach) and shows a readiness line for calibration.
- Clock: `SynchronizedClock` from Team 1 in production (not ready yet, so the phone says `reason: "clock"`); the labelled fixture clock in mock mode (decision 1).

## Mock scenario (`tools/client-demo/`)

Add `POST /__mock__/calibrate` (loopback only, synthetic):
1. It builds a plan from the currently connected devices, with a new `runId`, the next `runTag` (never reused within the mock's session) and the fixture palette `amber-blue-v1`.
2. It sends `calibration.prepare`, waits 1 s for `calibration.ready`, then sends `calibration.arm` with `startServerMs = now + leadMs` (default 3000) to the devices that said yes.
3. It records results, available at `GET /__mock__/calibration`.

## Tests (`client-frontend/tests/`, already in the gate)

- slot maths: before start, exact boundaries, the last slot, after the end
- golden packets for IDs 0, 1, 1023 and 2047 through the renderer with a fake clock and fake animation frames
- skipped frames, late arm, hidden mid-run, clock loss, superseding prepare, disconnect/epoch change: one result each, correct reason, no colour after the abort
- prepare filtering: not a participant, wrong session/epoch, opted out, stale arm
- the renderer never reads an audio clock (it only receives a `SynchronizedClock`)
- mock end-to-end: real WebSocket client joins, `/__mock__/calibrate`, receives prepare → ready → arm, runs with a fast fake clock, and the mock records `completed: true`

## Verification

- `bun run gate:client`.
- Browser: `bun run dev:client-demo`, join, then `curl -X POST localhost:18081/__mock__/calibrate`. The overlay counts down, flashes amber/blue for about 11 s, then closes, and `/__mock__/calibration` shows the result. Switching tabs mid-run gives `hidden`.
- Unverified after this slice:
  - real phones (whether the flash can be filmed and decoded)
  - physical display timing, since animation-frame timing isn't screen timing
  - clips for Team 3, which need phones and a reachable origin (slice 5)
- **Flash safety:** amber/blue alternates at up to 2.5 cycles per second. Masterplan §5.2 points to the W3C flash guidance and requires a skip route, which this slice adds. The palette choice stays in the plan, not in our code.

## Review decisions (2026-09-19)

1. Clock gate: production answers `ready: false, reason: "clock"` until Team 1's clock is wired in. Mock mode uses the labelled local fixture clock.
2. Manual column: ship Skip now. Draft a proposed ADR for a `participant.column` client message for the captain. Add the picker after it's agreed.
3. Countdown: "Hold your phone up" plus a countdown until 1 s before the start, then plain neutral.
