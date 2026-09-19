# Stage 02 - Audio and participant experience

Status: not started (foundation provided). Owner: Team 2 lead. Branch: feat/audio-client. Base: foundation-v1.

## Agent assignment

> Implement Team 2 from masterplan sections 5.2/5.3, 6 and 8. Own client-frontend/, packages/audio/ and tools/client-demo/. Selectively extract BeatSync audio behavior with attribution. Start with unlock/preload/scheduled click using an injected SynchronizedClock and fixtures; then frozen packet rendering and participant lifecycle. Keep journals/status/handoff current. Use shared schemas and never author a competing clock estimator.

## Available and runnable

Next shell/readiness preview; AudioEngine interface; original hashed tones; mock snapshot/assets/probes/broadcasts; packet encoder/vectors. Team 1's estimator is pending: use FakeClock in deterministic tests and a labeled fixture clock in local experiments.

Run `bun run dev:client-demo` (3000 + 18081); verify `bun run gate:client`. Extend Team 2 scenarios in tools/client-demo for joins/barriers/cues. The mock is loopback-only; real phone experiments require a deliberate reachable/HTTPS setup.

## Ordered slices and acceptance

1. One-context lifecycle/preloading: tap unlock, hash verification, actual decoded readiness, memory budget and one output-clock compensation method. Unit-test units/fallback; demonstrate known click on two phones with Team 1.
2. Join/resume/protocol adapter: authenticated identity, snapshot recovery, distinct clock/foreground/audio/assets, visible interruption resume. Develop against branch mocks, then real API.
3. OTC renderer uses shared codebook and pure server clock; derives slot from absolute time on each animation frame. Test IDs 0/2047, goldens, skipped frames, late start, hidden page, opt-out and run reset. Supply original test clips to Team 3.
4. Execute assigned clips at common playhead, prepare switches, cancel superseded nodes, future play/pause/seek/stop, gain/panic/audio-clock lease. Test stale/late events, missing assets and idempotency; a channel switch never restarts at zero.
5. iOS Safari/Android Chrome: interruption/foreground return, mute/volume, calibration visibility and two-minute onset/drift measurement with the documented recording procedure.

## Handoff

Team 1 receives ACK/status examples; Team 3 packet timing/render evidence and clips; Team 4 readiness/transport behavior. Add audio/renderer tests to the gate. Fake clocks/AudioContexts cannot satisfy the physical gate.
