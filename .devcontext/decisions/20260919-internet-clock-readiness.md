# Allow higher-latency participant networks explicitly

Date: 2026-09-19. Status: accepted by the integration captain under the user's explicit request to widen latency tolerances. Affects sync-control and audio-client.

The existing uncertainty ceiling of 20 ms excludes even stable paths whose best observed round trip exceeds 40 ms. A 3.75-second clean-sample freshness gate also aborted the user's calibration during network jitter. Connection recovery alone does not change those thresholds.

Add a shared `internet` clock profile with a 150 ms uncertainty ceiling and 10-second accepted-sample freshness gate. The audience selects it by default; `NEXT_PUBLIC_CLOCK_PROFILE=strict` selects the original 20 ms / 3.75-second policy. The shared estimator and operator retain strict defaults. No wire contract changes.

This adjusts admission/continuation eligibility only. Retain the minimum-RTT estimator, full 16-pair warmup, coded-pair filter, reply correlation, periodic probes, and epoch/disconnect invalidation. Report the actual uncertainty and selected mode. Do not relabel the masterplan's acoustic targets or claim a 150 ms uncertainty allowance measures actual error. Asymmetric path delays can bias the estimate even when replies are stable; the four-timestamp offset/delay calculation remains the one described in [RFC 5905 section 8](https://www.rfc-editor.org/rfc/rfc5905#section-8).

The previous strict policy remains available for rehearsal comparisons. The ten-second connection watchdog and five-second audio lease continue independently; a network outage can still stop calibration/audio. Refresh participant pages for the new policy and perform a fresh physical calibration/acoustic check.
