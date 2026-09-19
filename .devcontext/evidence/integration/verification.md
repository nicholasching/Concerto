# Local integration verification — 2026-09-19

Scope: main working tree after merge 5eb08ab, containing the captain integration committed with this report. Tasks 1/2 were pulled and fixed on their branches first (a35ce11 and b71425a). OTC 17299a1 and admin 82cd86f were merged without rewriting history. No remote push or Railway deployment.

## Environment

Windows 11 Home 10.0.26200; AMD Ryzen 7 7840HS, 8 cores/16 logical processors, 16.3 GB reported RAM. Bun 1.3.14; locked Python environment in `.venv`; desktop Chromium in the Codex browser. All load sockets use loopback on this one machine. Tests use isolated checkpoint/media/job directories under ignored `runtime/`.

## Software and source isolation

`bun run gate` passed: generated contracts/fixtures, dependency boundaries, type checking, lint, 14 contract + 202 sync/backend/testkit/load + 113 client/audio + 16 admin/selection tests (345 JS total), 79 Python tests, and backend/both frontend production builds. `bun run test:smoke` passed real HTTP responses from all three built services. `bun run test:e2e` passed in 21.3 s at 18:44:15 UTC. Logs remain under ignored `runtime/gate-final.log`, `runtime/smoke-final.log` and `runtime/e2e-final.log`.

`bun run check:isolation` passed frozen dependency installation and the full gate from `runtime/isolation/1789842274358`, with no `beatsync-source`, node_modules or build output copied from the working tree. After final clock/review edits, that source copy was refreshed and passed type checking, 342 selected JS tests (the unchanged three testkit tests were already covered by the complete isolation gate), all builds, production HTTP startup and real worker E2E. The final ruler/playhead alignment correction then passed `gate:admin` and production startup in the same source-free copy and visual inspection in Chromium. No OTC code changed after its isolation gate. The user's reference directory was not moved or deleted; `git diff foundation-v1 -- beatsync-source` is empty.

## End-to-end and browser

[Local E2E report](local-e2e.md) records actual HTTP/WebSocket joins, clock convergence, hash-verified audio bytes, three uploaded MP4s, real Python decode/debug preview, stale-geometry rejection, reviewed map commit, exact four-channel ID routing, preparation/transport/mix/panic, live-assignment exclusions and stopped restart recovery. Video is generated; audio scheduling is a recording double. The run-specific input manifest and hashes remain in its referenced runtime directory.

Final E2E capture: seed 7, clean case, 640×360, 30 fps, H.264/yuv420p, three cameras and four participating IDs. Input SHA-256 values: left `c7474911aa3bb1e2f997fad5b2b37564e2e279ffd46d0a34e949ac9cf178386d`; center `9ee3661efd7c648cb77038a02af1fb8285ac3123cbae5805b9c120f7bcb2aa45`; right `3ae57c1376e24a6d0103b43077d43c2341f378b0b58412292f308e02cb3354fa`. This is not the masterplan's three-4K-camera performance measurement.

Desktop browser walkthrough: sign in to the real operator; participant joins/resumes as device 0; both clocks synchronize; click Enable sound; all four audio assets verify/decode; choose Left; assign Percussion at a future time; prepare 1/1 phones; play at the common deadline and observe Playing; panic returns Stopped. Prepare and arm optical calibration: participant displays the running pattern and returns Calibration: done; operator reports 1 finished / 0 interrupted. Discard the test calibration afterward. This uses the actual Web Audio and FlashRenderer implementations, but no acoustic output timing or optical recording was measured.

After the final restart, the browser resumed device 0, its manual Left location and Percussion routing; it stayed stopped and required a fresh audio gesture. All four assets became ready again. The review filter showed the manual-column record without a fabricated dot. Timeline ruler and lane playheads were visually checked against clip start/end positions.

## Load and discovered failures

- A simulator using its own synchronized probe loop and fixed preparation wait failed with only 500/1500 clock-ready acknowledgements. Retained summary: [failure](load-probe-simulator-failure.md).
- Reusing production ClockSync and waiting for readiness restored 1500/1500 cue delivery, but an initial 30-second retest exposed readiness loss during 1000-phone assignment: only 328 were admitted. Rejected steady-state pairs could leave samples stale for another full probe interval.
- ClockSync now retries failed pairs promptly while preserving the estimator thresholds and optical clock model. A deterministic dropped-pair regression passes. Both a 45-second retest and the final 300-second run passed every one of 1500 joins, clock-ready acknowledgements and cue deliveries, all 1000 assignments, 150 reconnects and worker completion with zero client errors. Final control event-loop p99 was 41.5 ms, below the masterplan's 50 ms target on this machine. See [load-1500](load-1500.md), completed at 18:46:30 UTC.
- Browser verification found and fixed native timer receiver errors and a negative startup audio timestamp. Real HTTP upload found Bun's body reader did not expose the `releaseLock` method that a unit stream did. Corrected these paths and reran browser/HTTP checks. Server-side stderr retains failure diagnostics; no failures are reclassified as physical evidence.

## Limits

No phones, camera footage, venue network or prepared demo stems were supplied. Real iOS/Android interruption, screen brightness/visibility, original camera codecs, optical accuracy, sound propagation, measured inter-phone audio skew, a thousand physical listeners, Railway infrastructure and three consecutive rehearsals remain unverified. Local software completion is not stage acceptance. User requested local functionality before Railway work.
