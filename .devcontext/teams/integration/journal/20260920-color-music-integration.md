# Channel music visualizer integration

Status: verified for client software/browser integration; physical rehearsal pending. Owner: integration captain. Date: 2026-09-20.
Baseline: main `22e1f80`; teammate branch `origin/feat/color-music-sync` at `70e4cd1`, based on `7cbe031`.

## Request, scope and plan

Review and integrate the teammate's audience music visualizer into main. Preserve the three-channel show, shared clock and scheduled playback, calibration priority, manual-section fallback and reconnect readiness. No optical decoder, backend protocol or BeatSync reference edits are intended. The captain is integrating the explicitly supplied feature across its client consumers.

Use an isolated worktree so review/builds do not interrupt the active public dev session. Merge the original feature commit, fix demonstrated integration issues, run `bun run gate:client` and isolated playback/browser checks, then merge the verified result into main and publish it. No live show commands or backend reset are needed.

Acceptance: a ready, assigned phone shows its channel color with brightness reacting to its own actual audio; effective scheduled commands and panic determine display state; calibration and unresolved/manual/recovery controls remain available; analysis never changes the audible signal; meters and animation loops are cleaned up.

## Review findings

- The feature adds only four client files and merges without conflicts. It reads post-mix/lease audio from the existing output gain, preserving the audio graph's speaker connection.
- The initial display reads the last connection snapshot rather than ShowControl's effective scheduled state. Future commits and panic are already understood by ShowControl, so delayed/absent snapshots can leave the wrong display or channel color.
- The early performance return hides the calibration overlay, manual-section selection, and reconnect retry whenever a snapshot says playing, including phones which cannot actually play.
- Meter smoothing/peak decay is per animation frame, so otherwise identical phones at 30/60/120 Hz respond differently. Regression coverage and fixes will be recorded below.

## Verification

- Reproduced refresh-rate discrepancy: identical 200 ms release differed by 0.376 brightness between 30 and 120 Hz. Elapsed-time coefficients now agree within 0.001.
- Reproduced false energy from the existing 1 Hz / 0.0001-amplitude keepalive: byte sampling raised silent output from the intended 0.1 floor to 0.512. Float waveform sampling and a 0.0002 noise threshold suppress it. Byte quantization follows the [Web Audio specification](https://www.w3.org/TR/webaudio/#dom-analysernode-getbytetimedomaindata); no audio processing/gain was changed.
- `bun test ./client-frontend/tests/level-meter.test.ts ./client-frontend/tests/music-visualizer.test.ts`: 13 pass. Tests cover actual ShowControl commits with no later snapshot, future channel colors/clear, pause/resume, immediate panic/stale play, measured level changes, analysis-only disconnection, animation/meter cleanup and refresh-rate consistency.
- `bun run gate:client`: PASS. Schema/fixture/boundary checks, lint/typecheck, 14 contract tests, 157 client/audio tests, optimized Next build. Frozen install succeeded with no lockfile changes. Log: ignored `runtime/local/color-music-gate.log` in the isolated worktree.
- Real Codex Chromium browser, isolated Next on 3107 and synthetic protocol harness on 18101: verified Connected/In sync/Verified/Sound Ready after a genuine unlock; play displayed Melody blue at opacity 0.990; mute while seeking into the tone returned opacity to exactly 0.1; pause restored the full status/part view. This harness does not periodically send snapshots, demonstrating commits drive the display.
- Scheduled channel change selected Vocals purple. Calibration during playing hid the music surface and painted the original full-red packet; the harness recorded a completed packet with 2.002 ms maximum animation-frame lateness. After calibration, Vocals lighting returned. This is browser rendering telemetry, not filmed optical evidence.
- A second test tab resumed the same synthetic identity: the replaced tab hid the music surface and showed its connection notice; the new tab showed unlock/warmup controls before returning to Vocals lighting. Panic hid the surface and restored normal status without another snapshot. No browser errors/warnings were reported. All mock mutations targeted 18101, never the public/live backend.
- `git diff --check`: PASS. No backend, schema, audio engine, optical decoder, dependencies or reference-tree changes. Physical phone brightness/audio alignment remains a separate rehearsal check; automated graph and browser tests do not establish acoustic or display latency. The visualizer follows signal loudness, not a separate tempo/beat detector.

## Implementation

The teammate's meter/output tap and channel-color surface are retained. A small frame renderer now reads ShowControl's effective state each frame, lazily attaches one meter while playing, and disposes it on pause/panic/channel change/cleanup. The surface is an overlay within the audience page rather than an early replacement return. Calibration, missing manual section, disconnected/hidden/unsynced state, locked/warming sound and unverified music keep the normal controls. Meter reads observe downstream mix/lease output; music silence retains the branch's dim 10% color floor. No second clock, amplitude broadcasts or audio graph rewiring are added.

## Handoff

The merge preserves the teammate's original commit and all of main's OTC parallelism. Refresh audience pages, wait for readiness, assign musical channels and start the show. The frontend-only update needs no backend reset. No live calibration, show, registered identity or tunnel configuration was mutated by this verification. Use actual venue phones to compare brightness response, battery/display behavior and perceived synchronization before the demonstration.
