# Two-second controls and playback recovery

Status: implemented; software/browser verification below. Integration captain on main, baseline `cb271b1`. Physical onset comparison remains pending.

The user's prior calibration/UI fixes were committed and pushed as `cb271b1` before this work. Goal: two-second performance/assignment controls, a fresh clock before reconnect playback, and consistent first-start output timing. Preserve the live show, map and audience identities. No physical onset result is claimed from software checks.

Findings before implementation:
- The dashboard `futureServerMs` clamps every cue to four seconds, while the backend requires three seconds remaining on receipt. Simply changing the UI to two would reject commands after network transit.
- React polls clock quality every 250 ms. Snapshot/commit/lease handlers and `ShowControl.reloadEngine` do not independently check the current clock or audio readiness. A foreground refresh resets the estimator synchronously while the old engine can still receive commands; recovery must be gated at execution, not just by a rendered boolean.
- The audio mapping falls back to `currentTime` with no output compensation when the output timestamp is zero. Web Audio explicitly permits zero before the first rendered block. Source nodes retain that mapping even once the timestamp becomes valid. A later pause/play rebuild uses the warmed mapping, consistent with the user's symptom (not yet a measured physical cause).
- The BeatSync reference contains a 1 Hz / -80 dB output keepalive that the extraction omitted. Restore this small attributed behavior to warm/retain the output path before music, and wait for advancing, settled output timestamps before acknowledging playback.

Plan/checks: reproduce unready recovery and initial output cases in client/audio tests; implement synchronous readiness gating, output warmup/fallback and two-second cues; run client/sync/admin gates and focused integration/browser checks. Record physical verification separately. No estimator thresholds or optical clock compensation changes.

## Implementation and reproduced failures

`runtime/local/playback-before.log`: 36 passing tests and three new failures on the old code. Unready reconnect scheduled load/lease/transport; a clock reset allowed a commit instead of silencing; a reported 120 ms output delay was ignored. After fixes these pass. The real estimator/PlaybackEngine integration test waits for all 16 new pairs on first join and again on reconnect; no sources start during warmup, and recovered source offsets match the future shared playhead. Polling ready state does not recreate sources. Further tests cover changed output mapping, missing assets, expired prior assignments, a warming output's preparation ACK, new epochs and unchanged telemetry.

Implementation details and tradeoffs are in the [accepted decision](../../../decisions/20260920-playback-readiness-and-cue-lead.md). `PlaybackFacts.audioOutputReady` is an internal TypeScript change, reflected in the HTTP/WS harness; no wire schema change. Changes are local/uncommitted after the requested initial checkpoint push.

## Checks

- `bun run gate:client`: final pass with **142 tests** plus 14 contracts, including the expired-assignment regression from final review. Includes shared checks, typecheck/lint and production client build.
- `bun run gate:sync`: pass, 216 tests plus 14 contracts; production backend build.
- `bun run gate:admin`: pass, 22 tests plus 14 contracts; production admin build.
- `bun run test:e2e`: pass, then updated its assignment/play/mix deadlines to two seconds and passed again (calibration retains four). Real HTTP/WS, media hashes, Python decoder, routing, readiness, mix, panic, restart. Final disposable artifacts `runtime/e2e/fe3c0ba9-9511-4101-acf2-84cac7013107/`; generated video and recording-double audio are not physical evidence.
- `git diff --check`: pass. Reference source unchanged; the inspected audio-context source hash matches the recorded MIT provenance. No runtime files, footage or credentials are tracked.

## Browser checks

An isolated page at loopback 18093 bundled the production audio host/mapping/scheduler. Clicked a real browser gesture: running initially reported output latency 0 ms and outputReady false. It reached outputReady true after **823 ms**, with baseLatency 10 ms and outputLatency **40 ms**. Its first silent buffer was scheduled two seconds ahead; timestamp-derived output mapping error 0 ms. This is API mapping evidence, not acoustic timing.

The built audience/admin bundles were also checked against the disposable backend on 18090 (frontends 13010/13011). Audience reached Connected, In sync, Music Verified, Sound Ready with the one browser-required gesture. Admin showed assignment default 2 seconds; a Melody mute was accepted without lead-time error. No real audience identities or show settings were changed by these tests.

## Runtime and next physical check

The live app was stopped with zero phones connected and stopped transport. Restarted backend/frontends with the fixes, preserving show `dc329b95-989d-428b-807d-9927608eeba9` revision 3, seven identities, and map revision 3. New epoch `266cfbd8-2b31-4619-8549-986c5cd25ad9`; playback remains stopped. Hidden runner PID 45096 (`runtime/local/run-playback-services.ts`), backend 49216, client 33572, admin 51812 at verification time. Cloudflare PID 48044 remains connected. Public HTTPS operator authorization, WSS snapshot and clock round trip pass with no audience IDs allocated. First hidden-launch attempt failed a PowerShell/CIM type check; using the declared uint16 ShowWindow type succeeded.

Refresh admin and phones for the new bundle. On physical iOS/Android phones, wait for all readiness states, prepare, play once and record onset together; then disconnect one phone during a long clip and reconnect. It should remain silent while syncing and rejoin the current playhead. Compare first play with pause/play, plus Wi-Fi versus cellular. No measured acoustic tolerance claim yet; the widened internet profile and asymmetric delay can still affect precision. Temporary browser tabs/test servers are closed at handoff; live services remain running.
