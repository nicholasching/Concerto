# sync-control handoff

Read [stage brief](../../stages/01-sync-control.md), root rules/masterplan and shared schema notes
before changing code. Slice 1 is implemented; slices 2 through 5 are not.

## What Teams 2 and 4 can consume now

`@orchestra/sync` exports `ClockEstimator`, which implements the existing `SynchronizedClock`
interface. Do not write a second estimator.

```ts
const estimator = new ClockEstimator();              // inject { now } in tests
const groupId = estimator.beginProbeGroup();         // send clock.probe index 0, then index 1
                                                     // PROBE_CONSTANTS.PROBE_GAP_MS apart
estimator.accept({ serverEpoch, ...reply.payload }); // returns the accepted measurement or null
estimator.nowServerMs();                             // server time; offset is 0 until ready
estimator.quality();                                 // { ready, uncertaintyMs, sampleAgeMs }
estimator.waitTimeMs(effectiveServerMs);             // never negative
estimator.nextProbeDelayMs();                        // add your own jitter; you own the timer
```

Rules for consumers:

1. Stamp `t0` at the moment of sending, not when the message was built.
2. `clock.reply.serverEpoch` is authoritative. Passing it to `accept()` is what makes the estimator
   discard measurements from a previous server run; a probe carrying a stale epoch is answered
   rather than rejected, so this is the only recovery path.
3. `quality().ready` requires 16 measurements, uncertainty at or below 20 ms, and a sample no older
   than 3750 ms. It degrades on its own, so re-read it rather than caching a synced flag.
4. `uncertaintyMs` is half the best observed round trip. It is a quality signal under symmetric
   delay, not a bound on true error, and it is not audio accuracy.
5. Do not apply an audio nudge inside `toLocalPerformanceMs`; that belongs to the audio engine.

Server surface: `ws://<host>:8080/ws` accepts `clock.probe` and replies with `clock.reply`.
Any other client message returns a structured `error` with `code: "NOT_IMPLEMENTED"` and
`owner: "sync-control"`. A restart mints a new `serverEpoch`.

## How to run this independently

```bash
bun run dev:sync-demo   # backend on 8080, /ws serving clock probes
bun run gate:sync       # contracts, fixtures, boundaries, typecheck, lint, 54 tests, backend build
```

On a machine without Bun on PATH, install the pinned 1.3.14 from `mise.toml` first.

## Pending and blockers

Pending: identity registry and authenticated resume, role-filtered snapshots, subscriptions,
prepare/ready/commit barriers, uploads and jobs, map commit, checkpoint recovery, panic and audio
lease, and the socket load harness. Team 3 supplies the worker boundary for slice 4.

No unresolved software dependency blocks slice 2. Two coordination items for the captain:
`tools/load/` is not a workspace package and cannot resolve `@orchestra/sync`, so slice 5 will need
a manifest there and a root lockfile update; and slice 2 will define the join and resume HTTP
surface against the frozen contract, which Teams 2 and 4 should review before it is merged.

Not proven: no phones, no audio, no venue network, no load. The deterministic 10 ms p95 clock
target in masterplan section 8 has not been measured. Passing the gate is not feature completion.
