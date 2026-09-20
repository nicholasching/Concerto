# audio-client checkpoint

Music visualizer integration (2026-09-20): `feat/color-music-sync` now follows effective ShowControl transport/channel state each frame, reacts to post-mix audio, and yields to calibration/manual placement/recovery. Float samples ignore the audio keepalive; smoothing is refresh-rate independent. Client gate: 157 tests plus build passed. See [integration evidence](../integration/journal/20260920-color-music-integration.md); physical display/audio timing remains unmeasured.

Integration follow-up on main (2026-09-20 UTC): two-second cue support, synchronous fresh-clock/output/assets execution gates, output warmup/keepalive, and corrected fallback latency. See [current playback evidence](../integration/journal/20260920-playback-recovery.md). Historical slice status below is superseded by main integration. Physical acoustic comparison remains pending.

Status: in progress (slices 1-4 ready for integration; physical checks outstanding).
Owner: Team 2 human lead, to be named.
Branch: feat/audio-client. Base: foundation-v1 = ab59c27105627977ee52dc2bcd4276b4532b9e2a.

- Owned files: client-frontend/, packages/audio/, tools/client-demo/
- Implemented:
  - Slice 1 ([subplan 01](plans/01-audio-context-preload-click.md)): one-AudioContext host, gesture unlock, SHA-256/size-verified loading, 64 MB decoded budget, single server→audio time mapping, late cues refused. The user heard the test tone in desktop Chrome on 2026-09-19.
  - Slice 2 ([subplan 02](plans/02-join-resume-connection.md)): join and resume with a stored token, bad-token rejoin, capacity handling, token-bound socket, snapshot epoch/revision rules, BeatSync backoff reconnect, replaced-tab stop, five separate readiness states reported as `device.status`, full show preload after unlock, "Tap to resume" after an interruption.
  - Slice 3 ([subplan 03](plans/03-calibration-flash.md)): calibration prepare/arm handling, full-screen flash of the exact `otc-v1` packet from the server clock (slot from absolute time each frame), countdown, never-late rule, abort reasons (late/hidden/clock/disconnected/superseded/opted-out), Skip button, `calibration.result` with max frame lateness.
  - Slice 4 ([subplan 04](plans/04-channel-playback.md)): `PlaybackEngine` plays only the assigned channel from the shared timeline at common server times. It handles scheduled play/pause/seek/stop, channel switches at the shared playhead with a 30 ms crossfade, mix gain/mute/solo, immediate panic, an audio-clock lease gate (silent without a lease), and a 1 s late-join rejoin. `ShowControl` answers `assets`/`assignment`/`transport` prepares, applies commits in revision order and rebuilds from snapshots. The page shows channel, playhead and pending countdowns.
  - `tools/client-demo`: synthetic join/resume mock with drop/restart/devices controls, `/__mock__/calibrate`, and playback controls `assign`, `transport`, `mix`, `panic`, `lease`, `assets`, `playback`.
- Not yet: manual column picker (waits on [proposed ADR](../../decisions/20260919-113215-audio-client-manual-column.md)), effective mix in the snapshot ([proposed ADR](../../decisions/20260919-120306-audio-client-mix-in-snapshot.md)), phones (slice 5), real clock (Team 1).
- Independent command: `bun run dev:client-demo`.
- Gate: `bun run gate:client` passed 2026-09-19 on the slice 4 working tree (103 tests, build ok).
- Verified by the user 2026-09-19: the flash works in a visible desktop browser (`mock-run-2` completed, 8.6 ms max frame lateness).
- Unverified: listening to slice 4 playback (the automation window can't unlock audio; the display and protocol were checked), real backend, real clock, phones over a reachable HTTPS origin, the foreground switch, physical display timing, and filmed clips for Team 3.
- Next action: a person listens to the slice 4 checks in the handoff. Then subplan 05 (real phones), which needs a phone-reachable HTTPS origin. Phone checks and clips for Team 3 once a reachable origin exists.
- Dependencies: Team 1 supplies the real `SynchronizedClock` and join/socket API. The proposals in [handoff.md](handoff.md) need Team 1's agreement. The captain needs to review the `bun.lock` and `THIRD_PARTY_NOTICES.md` edits from slice 1.

Update this checkpoint at each handoff. Append experiment history in agent-owned journals.
