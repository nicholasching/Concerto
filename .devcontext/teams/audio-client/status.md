# audio-client checkpoint

Status: in progress (slices 1-3 ready for integration; physical checks outstanding).
Owner: Team 2 human lead, to be named.
Branch: feat/audio-client. Base: foundation-v1 = ab59c27105627977ee52dc2bcd4276b4532b9e2a.

- Owned files: client-frontend/, packages/audio/, tools/client-demo/
- Implemented:
  - Slice 1 ([subplan 01](plans/01-audio-context-preload-click.md)): one-AudioContext host, gesture unlock, SHA-256/size-verified loading, 64 MB decoded budget, single server→audio time mapping, late cues refused. The user heard the test tone in desktop Chrome on 2026-09-19.
  - Slice 2 ([subplan 02](plans/02-join-resume-connection.md)): join and resume with a stored token, bad-token rejoin, capacity handling, token-bound socket, snapshot epoch/revision rules, BeatSync backoff reconnect, replaced-tab stop, five separate readiness states reported as `device.status`, full show preload after unlock, "Tap to resume" after an interruption.
  - Slice 3 ([subplan 03](plans/03-calibration-flash.md)): calibration prepare/arm handling, full-screen flash of the exact `otc-v1` packet from the server clock (slot from absolute time each frame), countdown, never-late rule, abort reasons (late/hidden/clock/disconnected/superseded/opted-out), Skip button, `calibration.result` with max frame lateness.
  - `tools/client-demo`: synthetic join/resume mock with drop/restart/devices test controls, plus `/__mock__/calibrate` and `/__mock__/calibration`.
- Not yet: manual column picker (waits on [proposed ADR](../../decisions/20260919-113215-audio-client-manual-column.md)), channel playback (slice 4), phones (slice 5), real clock (Team 1).
- Independent command: `bun run dev:client-demo`.
- Gate: `bun run gate:client` passed 2026-09-19 on the slice 3 working tree (71 tests, build ok).
- Unverified: the flash in a visible browser (the automation window is hidden and gets no animation frames), real backend, real clock, phones over a reachable HTTPS origin, the foreground switch, physical display timing, and filmed clips for Team 3.
- Next action: a person watches the flash once in a visible desktop browser (steps in the handoff). Then subplan 04 (channel playback). Phone checks and clips for Team 3 once a reachable origin exists.
- Dependencies: Team 1 supplies the real `SynchronizedClock` and join/socket API. The proposals in [handoff.md](handoff.md) need Team 1's agreement. The captain needs to review the `bun.lock` and `THIRD_PARTY_NOTICES.md` edits from slice 1.

Update this checkpoint at each handoff. Append experiment history in agent-owned journals.
