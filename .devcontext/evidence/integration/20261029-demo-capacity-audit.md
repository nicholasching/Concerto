# 250-device demo readiness audit

Date: 2026-10-29. Reviewed baseline: `3d08a6d` (`codex/stage-calibration-reliability`). Owner: integration captain.

## Verdict

**Control capacity for 250 simulated connections is supported by measured evidence. Unconditional readiness for the complete on-stage demo is not established.** Remaining playback controls, optical regression failures, media preload size/recovery, and unverified current hosting limits prevent a clean sign-off. Adding replicas is incompatible with the current single-writer architecture and would not resolve these issues.

No new Railway test traffic, participant sessions, media transfers, resets, deployments, or configuration changes were generated for this audit. Local checks use disposable loopback services. Railway browser access timed out and computer use stopped because it could not verify the browser URL; live resource/quota settings could not be revalidated.

## Findings, ordered by demo impact

### 1. High: playback retains the operator clock dependency and only 500 ms of command transit allowance

`admin-frontend/src/lib/clock.ts` creates the default strict ClockSync: best RTT must be <=40 ms and accepted samples <=3750 ms old. `PerformPanel.tsx` disables Prepare cue / Start show until this lock exists. Pause, Stop, seek and gain controls also call `futureServerMs(2)` and fail when the clock is not ready, even where their buttons appear enabled. The separate immediate Panic action does not need this clock.

Even with a perfect operator estimate, the UI chooses now +2000 ms while `backend/src/app.ts` requires a minimum 1500 ms remaining lead. A combined upload/transit/command-queue delay >500 ms therefore rejects an otherwise legitimate playback/mix command. Local characterization advanced the server by 501 ms and reproduced HTTP 409 `INSUFFICIENT_LEAD_TIME`. HTTP request duration is round trip and does not by itself measure this one-way budget.

Calibration's five-second server-selected schedule fixes only calibration. Recommended next change: apply server-owned timing to immediate performance intent as a separate reviewed change, retain explicit scheduled APIs if needed, and remove operator-quality gating from those intent controls. Until then, rehearse Prepare/Play/Pause/Stop/mix over the exact operator network; keep Panic visible. There is no validated generic workaround for an operator who cannot obtain strict lock.

### 2. High: the current full optical gate is red

Fresh root `bun run gate` passed shared checks and all JS tests/builds, but Python finished **164 passed / 9 failed in 255.53 s**. Eight failures concern expected recovery or crossing rejection in actual encoded synthetic video; one concerns Windows CLI failure-output cleanliness. These are failures on the unmodified baseline, not a regression introduced by an audit patch. They contradict an unqualified reading of older passing handoffs.

Reproduced with analysis budget 3 and the Docker image's native-thread caps: v2 `faint-colors` localized only IDs `{0,3}` out of `{0,1,2,3,4,5}`; v2 `crossing` localized an ID the negative-scene test requires to remain unresolved. The crossing assertion failure alone does not prove an identity swap; trace identity/geometry against independent truth before deciding whether runtime behavior or the test expectation is wrong under the accepted valid-code policy. Do not weaken the assertion or increase decoder tolerance just to obtain green tests.

The Windows malformed-video CLI case passed with budget 3/thread caps; the original failure included Windows spawn teardown diagnostics after the JSON error. This does not establish a Linux production failure. Clean three-camera E2E decoding still passed, so this is not a blanket decoder outage.

All failures in the full run:

- `test_cli_parallel_camera_failure_never_publishes_success`
- `test_v2_real_video_recovery_and_correct_positions[emissive-background-30]`
- `test_v2_real_video_recovery_and_correct_positions[faint-colors-30]`
- `test_v2_retains_negative_scene_checks[crossing]`
- `test_red_blue_washed_dim_and_reflected_screens[emissive-background]`
- `test_red_blue_washed_dim_and_reflected_screens[reflected-motion]`
- `test_washed_pilots_clothing_glow_and_mixed_brightness_mp4`
- `test_reflected_blue_glow_motion_and_single_frame_glare_keep_full_packets`
- `test_crossing_tracks_do_not_swap_accepted_ids`

Before relying on full-room optical mapping: resolve the current gate failures and test real current-build near/back-row captures, or rehearse the clearly labeled manual four-section fallback. Optical positions require review before commit.

### 3. High operational gap: the actual music is substantially larger than the public test asset

The saved **local** show (not a fresh production observation) has three stereo 48 kHz MP3 tracks, about 272–276 seconds each: **27,316,706 encoded bytes / 26.05 MiB**, and approximately **299.86 MiB decoded PCM per phone**. Every phone preloads all tracks, regardless of its eventual assignment. The latest recorded production state was an empty placeholder show; production music readiness has not been freshly checked during this audit.

For 250 uncached devices, that local set means **6.36 GiB** of audio downloads. Ideal shared useful throughput, excluding page assets, overhead and retries:

| Complete preload window | Aggregate throughput required |
| --- | --- |
| 60 seconds | 910.6 Mbit/s |
| 5 minutes | 182.1 Mbit/s |
| 100 Mbit/s shared useful capacity | At least 9.1 minutes |

The successful public test used a **1,024,044-byte original tone**, two finite download waves at 32 KiB/s per phone. It verified 512,022,000 bytes in total. It does not prove a 26 MiB show loads quickly on 250 independent phones. At that artificial per-phone test rate the local show would take about 13.9 minutes; this is a comparison, not a measured venue rate.

`packages/audio/src/assets.ts` decodes every missing track concurrently and accounts against the 512 MiB budget **after decoding**. The limit excludes compressed bytes, temporary decode buffers, browser UI and other memory, so it is not a safe-device-memory guarantee. Actual AudioContext sample rate can also affect decoded allocation. Short, prepared demo exports and early preload reduce both risks. A CDN can reduce Railway egress/control contention but cannot create venue Wi-Fi capacity; immutable hashed cache headers already exist on the asset route.

### 4. Medium: recovered playback ACKs remain excluded until another preparation

`backend/src/messages.ts` restores missing calibration preparations only. A clock/foreground/audio readiness loss removes a transport/assignment ACK; the subsequent healthy `device.status` does not replay those preparations. `ShowControl.refreshReadiness()` updates execution readiness but does not resend their ACKs.

Local integration characterization reproduced ready → not-ready → healthy, followed by Play returning HTTP 409 `NOBODY_READY`. Sending Prepare again restored the ACK. With other phones still acknowledged, only that ready subset starts, so this can silently reduce participation. Next change: recover exact current transport/assignment ACKs with appropriate revision/lifecycle guards. Immediate runbook mitigation: wait for music/output/clock readiness, then re-prepare immediately before Play.

### 5. Medium: transient/hung music fetches have no bounded automatic recovery

`loadTrack()` calls fetch/arrayBuffer without an abort timeout or retry; `preloadTracks()` reports failures and releases the in-flight entry. The page retries on show/audio state dependency changes, but a socket reconnect, ordinary status tick or online event does not itself guarantee another preload. An explicit repeat preload succeeds in the local 503-then-200 characterization; the first call alone makes only one request. The audience error has no Retry music button.

At 250 simultaneous downloads, a dropped transfer can therefore leave a foreground, connected phone waiting indefinitely. Next change: bounded per-track retry/backoff with cancellation and an explicit retry action, preserving hash verification and deduplication. Avoid a synchronized refresh storm as the primary recovery plan.

### 6. Medium: hosting allocation, storage headroom and billing cutoff are not freshly verified

Previously observed configuration: one production replica, Virginia region, serverless disabled, root Dockerfile, public port 3000, internal backend/admin 8080/3001, persistent `/data`, `/api/health` startup check, On Failure restart, and `OTC_CPU_BUDGET=22` intended for a 24-vCPU allocation. Native BLAS/OpenMP pools are capped at one. These settings are documented in `docs/railway-deployment.md`; no `railway.toml` exists, so dashboard settings remain authoritative.

The worker detects cgroup/affinity CPU capacity and caps its frame-analysis budget, runs one job at a time, uses bounded shared frame slots and process-tree cancellation. However, 22 analysis workers is not an OS reservation leaving two cores for control: camera coordination, codec threads and Next/Bun work are additional. Memory scales with frame slots, process heaps and detector scratch space. The prior public load did not run real 4K recognition alongside the 250-client music workload.

Confirm actual service CPU/RAM limits, volume size/free space and usable credits/spend cutoff before rehearsal. Check storage for originals, temporary chunk+assembled upload overlap and debug artifacts. One-replica operation is required; avoid autoscaling horizontally. Do not redeploy during capture/playback: persisted media/show/identities survive but a new epoch stops playback and invalidates unfinished runs. The health endpoint confirms HTTP process responsiveness, not free disk, Python processing success or mobile sound readiness.

### 7. Medium policy risk: already-armed calibration still aborts after ten seconds without an accepted pair

The internet admission threshold is <=750 ms best RTT, sixteen accepted pairs, and <=10-second sample freshness. `FlashRenderer` rechecks this on every frame of the 11.75-second pattern, including countdown. Hidden/disconnected phones also abort; an interrupted run does not resume. The proposed bounded holdover/latching design has **not** been implemented. Keep this policy explicit; a correctly delivered cue alone does not guarantee completion if probes become stale. The current pipelined-probe public test passed this exact policy under its seeded jitter.

### 8. Medium access risk: production operator authentication is deliberately weak

The user-selected production secret is very short and protects destructive audience reset, Panic and show controls. Constant-time comparison does not compensate for low entropy. The camera login is rate-limited; ordinary operator HTTP/socket authentication has no comparable brute-force limit in the reviewed code. Rotate to a strong operator secret before broad public use; do not distribute it to audience phones. No credential value is recorded here and no rotation was attempted.

### 9. Lower priority: retained identities inflate operator telemetry and consume the fixed namespace

The last remote observation recorded 1,012 registered identities, zero connected participants. The allocator never recycles IDs and has a total capacity of 2,048: that observation left 1,036 new identity slots, enough for a fresh 250-person audience but not unlimited test/reload cycles.

Admin snapshots include disconnected identities, locations and assignments. The server pushes a full snapshot up to twice per second while an operator socket is open; the UI additionally polls once per second. A local 1,262-identity characterization produced a ~501,562-byte JSON snapshot; 200 build+serialize iterations measured p50 3.47 ms, p99 10.30 ms. At three full snapshots/second this is ~1.5 MB/s of raw JSON per operator tab before any transport encoding. This is an estimate, not measured Railway billing or CPU capacity.

A deliberate pre-event audience Reset can clear old test identities/maps while preserving the show, but revokes existing participant identities and stops the audience; it must happen before real attendees join. No reset was performed. Keep only necessary operator tabs open. Consider removing redundant polling or using telemetry deltas later.

## Verified boundaries and test evidence

- Shared schema/fixture generation, boundary isolation checks, TypeScript and ESLint pass. BeatSync reference diff against `foundation-v1` remains empty.
- **460 JS tests pass:** 19 contracts, 249 sync/backend/testkit/load/deploy, 161 audience/audio, 31 admin/selection. Backend and both Next production builds pass. Python Ruff passes; full Python gate fails as recorded above.
- **Local seven-scenario E2E passes in 21.8 s:** actual HTTP/WebSocket joins, asset hashes, real Python decoding of three generated red/blue MP4s, reviewed map commit, four-lane routing, playback/mix, manual late join, Panic and persisted stopped restart. Audio output is a recording double and footage is synthetic.
- Local characterization reproduces the transport transit and ACK recovery failures and explicit second-preload behavior. No runtime source was changed to make them pass.
- Existing public test at runtime commit `b0b2d39` (same runtime as `3d08a6d`): 250 joins, 245/245 eligible full patterns complete, five intentional exclusions, 25 ACK recoveries, five identity-preserving reconnects, 500 verified audio downloads, zero protocol errors/interruptions, minimum estimated arm margin 3683.6 ms. Process-window backend loop p99 3.46 ms. See `railway-calibration-250.json` for test limitations and exact metrics.
- **Fresh five-minute local 250-client load passes:** 250 joins/ready ACKs/cues, 25 reconnects, 250 targeted assignments applied, zero client errors or admission retries; synthetic CPU-active worker completed. Join wave 88 ms / every socket open at 186 ms; cue margin p50 4990 ms; backend loop p99 14.86 ms / max 71.34 ms. The optical suite/E2E ran on the same laptop during part of this run, so this is not an isolated hardware benchmark. It exercises loopback control and synthetic worker contention, not independent radios, real media decode or the complete Next proxy stack. See [local report](20261029-local-load-250.md).
- Full clean workflow details: [new E2E report](20261029-local-e2e.md). Reproduced failure responses/snapshot costs: [characterization](20261029-characterization.json).

Raw new logs/reproduction scripts: ignored `runtime/demo-capacity-audit/` (gate, focused optical rerun, characterization, E2E, local load). Existing historical reports remain unchanged.

All local audit test processes have exited. Disposable backend ports 18089/18090 have no listeners at teardown. Runtime source, dependencies, deployment configuration and reference files remain unchanged; only audit context/evidence was added. No push/redeploy was performed.

## Pre-demo completion sequence

1. Resolve playback operator timing/ACK recovery and current optical failures; rerun affected gates locally. Do not silently change the calibration freshness or decoder-acceptance policy.
2. Confirm Railway resource/storage/quota settings and deploy only a verified release in a planned window. Rehearse Panic and stopped restart. No further production load testing is authorized by this report.
3. Upload/save the approved, preferably short demo stems; verify four lane labels, section presets, actual hash/decode/music readiness on iOS and Android. Do not infer this from the local saved-show metadata.
4. If clearing old test identities, Reset before admitting the audience. Join early and preload well before the stage slot. Keep the operator on a rehearsed stable connection and phones visible/unlocked.
5. Rehearse fresh calibration with representative near/back-row phones and original camera uploads. Review ambiguous results; rehearse the manual four-section fallback and a smaller participating group.
6. Prepare again after readiness stabilizes, confirm the current ACK subset, then Play. Listen on real phones and exercise pause/stop/mix/Panic. Freeze deployments and show edits for the event.

A successful rehearsal with the intended assets/network/devices is the remaining physical acceptance criterion; a 250-socket test cannot certify the auditorium network or speaker/display timing.
