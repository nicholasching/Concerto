# Connectivity and clock investigation — 2026-09-19

User reports intermittent disconnects and phones losing clock readiness during named-tunnel testing. Captain investigation on main; preserve the existing named Cloudflare changes, backend epoch, and the user's calibration/routing. No token or resume credential belongs in this journal.

## Plan and success criteria

- Correlate connector failures with Windows networking and live participant readiness.
- Compare the same clock lifecycle through loopback, the local audience proxy, and the public named origin. Distinguish lack of recent clean clock samples from a closed WebSocket.
- Reproduce any application recovery defect before changing it; retain the measured timing gates and verify affected gates from the repository root.

## Evidence collected

- Named connector log reports all four QUIC connections dropping around 20:37:16, 20:41:48 and 20:47:23 UTC (16:37, 16:41, 16:47 Toronto). At 20:41:48 Windows explicitly returned `A socket operation was attempted to an unreachable network`; other incidents show no recent network activity and, at 20:47:36, DNS resolver timeout.
- Windows WLAN AutoConfig event 8003 at 16:41:47.571 and 16:47:24.993 reports disconnection to establish a new connection. These corroborate host Wi-Fi changes at the tunnel outages. This is not evidence of a Cloudflare service-wide failure.
- Snapshot read during investigation: backend epoch `c90dd577-a629-4c91-99f0-78fc77c99cc3`, transport stopped, foreground devices 14–17 connected with audio unlocked and all four assets decoded. Clock sample ages were 4.87–7.91 seconds; uncertainties 9.32–20.21 ms. Run tag 12 reports all four incomplete with reason `clock`.
- Readiness requires 16 accepted probe pairs, uncertainty <=20 ms, and an accepted sample age <=3,750 ms. Paired probes reject inbound gap distortion above 5 ms. Steady cadence is approximately 2.5 seconds with jitter, with rapid retries already implemented for impure/lost pairs. Do not widen these thresholds just to make the UI green.
- Backend rolling event-loop lag: p50 8.50 ms, p95 12.67 ms, p99 23.64 ms, max 319.04 ms over 10,000 samples. This is historical process responsiveness, not physical phone timing evidence.

## Experiments and outcome

The ignored `runtime/sync-diagnostic.ts` ran the actual shared ClockSync simultaneously over backend loopback, the local Next audience proxy, and the named public origin for 90 seconds. It allocated devices 18–20 and closed only its own sockets afterward. No audio, assignment, transport or calibration commands were sent. Readiness percentage excludes the first five seconds.

| Path | First ready | Ready samples | RTT min / median / p95 / max | Pure / impure pairs | Max accepted sample age |
| --- | --- | --- | --- | --- | --- |
| Backend loopback | 1.51 s | 100% | 0.30 / 1.51 / 3.61 / 4.19 ms | 49 / 0 | 2,758 ms |
| Audience loopback | 1.74 s | 100% | 0.40 / 1.88 / 3.60 / 4.90 ms | 49 / 0 | 2,771 ms |
| Named public origin | 1.73 s | 98.98% | 16.44 / 20.12 / 106.45 / 164.93 ms | 49 / 22 | 4,521 ms |

No socket closed during this test; no schema errors occurred. The external path briefly lost readiness due to rejected/jittered pairs despite remaining connected. This confirms a difference between clock readiness and connection status, and explains why a calibration can abort without a socket disconnect. It does not prove phone acoustic accuracy or characterize every phone network. Later live snapshot showed all four foreground phones ready again, uncertainties 9.47–19.37 ms.

Source review exposed a separate recovery defect: only the initial socket snapshot had a timeout. After connection, a silently broken OPEN socket could remain connected indefinitely without an onclose event, and wake() skipped connected sockets. A regression test reproduced this before the fix (`expected closed=true, received false`). HTTP joins also had no deadline, so an unresolved fetch blocked later attempts.

## Implemented recovery

- Participant connections now wait at most 10 seconds without a validated message for the current identity/session/epoch, then close their own socket and use existing backoff/resume/snapshot recovery. Leases and clock replies renew this deadline even when clock quality is insufficient; invalid or wrong-epoch traffic does not. Disconnect/stop/replaced states cancel timers.
- HTTP join/resume uses a 10-second abort deadline spanning the response body. Timeout leaves the saved identity intact and releases the shared pending request so a retry can proceed.
- No shared contract or estimator threshold changed. No connector/backend restart, hostname change, user-device disconnect, or calibration mutation was issued. The confirmed Wi-Fi switching would interrupt either QUIC or HTTP/2, so changing tunnel protocol is not justified by this evidence.
- Focused regression checks: 25 connection/join tests pass, including silent OPEN socket recovery, healthy validated traffic, stale-epoch rejection, timer cleanup, hanging joins and identity-preserving retry.
- `bun run gate:client`: PASS, including 119 participant/audio tests, 14 contracts tests, generated contracts/fixture checks, source boundaries, full typecheck/lint and the participant production build. The live backend retained the same epoch; a final read showed foreground devices 14–17 all clock-ready with uncertainties 8.66–19.42 ms. This is a point-in-time recovery observation, not proof the host uplink will stay stable.
- Consulted [Cloudflare WebSocket guidance](https://developers.cloudflare.com/network/websockets/) and [connector run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/) while evaluating recovery and a possible protocol change. The observed local network events are the evidence for this incident; no provider-wide outage is inferred.

For the next physical test: keep the server on a single stable network (wired if available), keep phone pages visible, refresh audience clients to load the recovery fix, wait for fresh clock readiness, then create a fresh calibration. Do not reuse the aborted run as completed. No physical acoustic claim.
