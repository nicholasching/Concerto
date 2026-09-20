# Gate playback on fresh clocks and use two-second controls

Date: 2026-09-20 UTC. Status: accepted by the integration captain under the user's request. Affects audio-client, sync-control and admin-console. No wire schema or estimator policy changes.

## Context

The operator requested two-second controls, resynchronized reconnects, and reliable first playback. Regression tests reproduced snapshots/commits/leases executing while clock readiness was false, plus a 120 ms uncorrected output delay in the timestamp fallback. React's 250 ms clock display and asynchronous effects must not authorize audio execution.

The [Web Audio output timestamp specification](https://www.w3.org/TR/webaudio/#dom-audiocontext-getoutputtimestamp) permits zero timestamps before audio rendering starts. Running alone does not establish output timing. A source node retains its scheduled audio time when the mapping subsequently changes.

## Decision

- Transport, mix and default assignment cues use operator server-now + 2000 ms. Backend admission requires 1500 ms remaining at receipt, leaving 500 ms for HTTP transit without shifting the shared deadline. Longer-delayed commands fail visibly. Calibration still requests four seconds; panic stays immediate.
- ShowControl checks current connection/foreground clock readiness, running and warmed output, and exact assigned/pending-channel asset hashes on every engine update. Disconnect silences and invalidates the lease. Recovery waits for a reconnect snapshot and the normal full 16-pair clock warmup. Coalesce delayed state, load once when ready, then rejoin playing state one second ahead at that future playhead.
- Output readiness requires advancing output timestamps stable for at least 250 ms within 20 ms. Invalid or over-one-second-stale timestamps are unready. Interruptions invalidate warmup. Without this API, wait for an advancing audio clock and compensate reported base/output latency only in the fallback. Valid timestamp mapping never subtracts latency twice.
- Restore the reference's attributed 1 Hz / -80 dB keepalive to warm the output path before music and retain it during pauses. One oscillator per AudioContext, explicitly disposed. It is below the audible frequency range and costs continuous audio rendering while active.
- Keep the graph across unchanged asset/clock telemetry. Audience shows Sound Ready/Warming up; prepare ACKs explicitly exclude a warming output.

## Verification and limits

See [journal](../teams/integration/journal/20260920-playback-recovery.md). Tests cover 16 fresh pairs, reconnect source offsets, interruption/output changes, idempotent recovery, and two-second deadlines after 300 ms transit. Browser output timestamps are software mapping evidence, not acoustic onset. Internet/cellular eligibility remains 150 ms estimated uncertainty; asymmetric networks and hardware can still contribute audible skew. Physical phone comparison remains required.
