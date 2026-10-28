# Public calibration load test

From repository root, set OPERATOR_SECRET privately, LOAD_BASE_URL to the public audience origin and LOAD_CONTROL_URL to its /control origin (or the backend origin for local testing). Then run:

```sh
bun tools/load/calibration-stage.ts
```

LOAD_CLIENTS defaults to 250 and cannot exceed 250. LOAD_REPORT defaults to ignored runtime/calibration-stage-load.json. The script refuses an existing calibration or active performance. It preserves the saved show and only creates/discards its own calibration, targeting its test devices. Test identities remain allocated; do not reset an audience to clean them up. With an empty show it uploads one original eight-second fixture WAV without saving it into the show. Otherwise it downloads the existing stems, verifies their byte sizes/hashes, and never logs credentials.

Uses the actual ClockSync and CalibrationSession implementations with seeded ordered application-layer delays: one-way base 80/160/240/320 ms, shared/per-probe jitter and uplink/downlink queue spikes. Native WAN latency is additional. Runs 25 clock-readiness recovery cases, five identity-preserving reconnects, then a server-scheduled calibration with three seconds of injected operator command delay while repeated music downloads run. Checks each phone accepts one future arm with positive margin. Stop/cleanup is in finally.

The JSON report separates HTTP response-header timing, full media transfer timing, clock uncertainty and cue delivery margin. This is a single-generator public control/media test, not independent venue Wi-Fi radios, browser audio decode, speaker timing, camera footage, or a physical rehearsal.
