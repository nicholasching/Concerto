# Public calibration load test

From repository root, set OPERATOR_SECRET privately, LOAD_BASE_URL to the public audience origin and LOAD_CONTROL_URL to its /control origin (or the backend origin for local testing). Then run:

```sh
bun tools/load/calibration-stage.ts
```

LOAD_CLIENTS defaults to 250 and cannot exceed 250. LOAD_REPORT defaults to ignored runtime/calibration-stage-load.json. The script refuses an existing calibration or active performance. It preserves the saved show and only creates/discards its own calibration, targeting its test devices. Test identities remain allocated; do not reset an audience to clean them up. With an empty show it uploads one original eight-second fixture WAV without saving it into the show. Otherwise it downloads the existing stems, verifies their byte sizes/hashes, and never logs credentials.

Uses the actual ClockSync, CalibrationSession and FlashRenderer implementations with seeded ordered application-layer delays. At 250 clients, 245 have one-way base 80/135/190/245 ms plus shared/per-probe jitter and uplink/downlink queue spikes. Five have 450 ms each way, deliberately beyond admission, and must remain excluded without blocking the ready subset. Native WAN latency is additional. Runs 25 clock-readiness recovery cases, five identity-preserving reconnects, then a server-scheduled calibration with three seconds of injected operator command delay while repeated music downloads continue through the whole 11.75-second pattern. Each eligible phone must receive one future arm and complete the real renderer's timing/clock gates without interruption; excluded phones must receive none. Paint is a no-op, so this proves no physical screen behavior. Stop/cleanup is in finally.

Media is streamed and hash-verified at 32 KiB/s per simulated phone. With an empty show the script builds a 32-second original tone by repeating the eight-second fixture with corrected WAV sizes, without saving a show. This keeps two finite download waves overlapping onboarding and the full pattern, instead of generating unlimited refetch traffic.

Readiness can change during the three-second operator delay. The arm response determines the selected subset: at least 99% of the modeled eligible phones must still be ready, every selected phone must receive one future arm and finish the pattern without interruption, and every excluded phone must receive no arm. The report identifies transient exclusions separately from the five deliberately over-limit clients.

The JSON report separates HTTP response-header timing, full media transfer timing, clock uncertainty and cue delivery margin. This is a single-generator public control/media test, not independent venue Wi-Fi radios, browser audio decode, speaker timing, camera footage, or a physical rehearsal.
