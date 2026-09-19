# Internet clock readiness — captain integration, 2026-09-19

## Request and baseline

The user explicitly requests wider latency tolerance for mobile-data/hotspot participants after the connection-recovery fixes improved venue Wi-Fi behavior. Work is on main at a052e68, preserving the uncommitted named-tunnel and connection-recovery changes. Shared clock producer and participant consumer are coordinated here under the integration assignment; no protocol change is required.

Prior [connectivity evidence](../../integration/journal/20260919-sync-connectivity.md) measured local readiness 100% versus 98.98% through the named tunnel over 90 seconds, with public RTT spikes to 165 ms and accepted sample age to 4.52 seconds. This is not a measurement of the user's cellular devices. A fresh read shows device 14 near the existing 20 ms uncertainty ceiling (19.84 ms), with other foreground devices currently ready.

## Plan and decision

- Keep strict shared estimator defaults: uncertainty <=20 ms (best RTT <=40 ms), accepted sample age <=3,750 ms.
- Add an explicit internet profile for participants: uncertainty <=150 ms (best RTT <=300 ms), accepted sample age <=10,000 ms. Default the audience application to this profile, with `NEXT_PUBLIC_CLOCK_PROFILE=strict` restoring the original policy at startup/build.
- Retain 16 clean paired measurements, 5 ms pair-gap distortion filtering, minimum-RTT offset selection, epoch invalidation and periodic retries. These acceptance settings do not change the offset estimate, prove acoustic accuracy, or fix an unavailable network.
- Show the selected timing mode and actual uncertainty, including when the clock is unready. Mark higher-uncertainty readiness so the expanded policy does not imply the original timing target was measured.
- Verify sustained 240 ms RTT, the 300 ms boundary, rejection above the new bound, temporary sample gaps, expiry, reset and strict compatibility with deterministic tests. Run `gate:sync` and `gate:client`; preserve the running backend/tunnel and user calibration.

## Verification and handoff

- Before implementation, three new lifecycle tests failed on internet readiness / the 300 ms boundary / temporary gaps; strict compatibility passed. After implementation all 34 sync package tests pass.
- `bun run gate:sync`: PASS (207 focused tests, 14 contract tests, shared checks and backend build). `bun run gate:client`: PASS (119 focused tests, 14 contract tests, shared checks and participant production build).
- Real named-origin browser verification exposed an additional delivery issue: server HTML included the new timing mode, but an old cached page JavaScript chunk hydrated over it. Normal reload reproduced the mismatch. Local chunk headers were `must-revalidate, no-cache`; Cloudflare's public response advertised a browser `max-age=14400`. Thus a refreshed-looking page was not sufficient evidence the new policy was running.
- Audience Next development config now uses a per-server deployment ID for fresh asset URLs and adds CDN no-store headers to development assets. Production asset handling remains unchanged. This uses the supported [Next deployment ID cache-busting mechanism](https://nextjs.org/docs/app/api-reference/config/next-config-js/deploymentId). The Next config reload may briefly reconnect participants, while the backend/session remains running.
- Delivery fix verified over real HTTPS: static scripts now include `dpl=local-...`, the public chunk response reports `CF-Cache-Status: BYPASS`, `CDN-Cache-Control: no-store` and browser `must-revalidate, no-cache` rather than a four-hour lifetime. `gate:client` was repeated after the config change and passed with the same 119 focused / 14 contract tests and production build.
- Browser verification after ordinary reload: named origin remains Connected / Clock synced with `Timing tolerance: Internet / cellular` and actual uncertainty 9.3 ms after hydration, with no mismatch overlay. Reused only the agent's test identity 13 and closed the temporary tab afterward. Audio/calibration were not initiated by the agent. Backend epoch remained `c90dd577-a629-4c91-99f0-78fc77c99cc3`; the user's calibration tag advanced independently to 14.
- `git diff --check`: PASS. Existing named tunnel and silent-connection-recovery edits remain preserved. No commit or push was requested in this follow-up.

The broader policy is an explicitly requested testing tradeoff; physical phone/camera/audio checks remain outstanding. No physical acceptance target is changed. Next action: refresh each actual phone, verify the Internet / cellular label, wait for readiness and start a fresh physical calibration. Record alignment separately, especially for phones reporting relaxed timing readiness.
