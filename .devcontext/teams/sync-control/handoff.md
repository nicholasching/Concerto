# sync-control handoff

Read [stage brief](../../stages/01-sync-control.md), root rules/masterplan and shared schema notes
before changing code. Slices 1 and 2 are implemented; slices 3 through 5 are not.

## Joining, and the socket credential

**Breaking change since slice 1:** `/ws` now authenticates at upgrade. A client must join over
HTTP first and open the socket with that token; an unauthenticated socket is refused with 401.

```text
POST /api/sessions/<sessionId>/join      body {} or { "resumeToken": "..." }
  -> { sessionId, serverEpoch, deviceId, resumeToken, revision }
ws://<host>:8080/ws?resumeToken=<token>            participant socket
ws://<host>:8080/ws?operatorSecret=<secret>        operator socket, receives coalesced snapshots
GET  /api/sessions/<sessionId>/snapshot
  header x-resume-token: <token>      -> that device's ParticipantSnapshot
  header x-operator-secret: <secret>  -> AdminSnapshot
```

Device IDs start at **0** and 0 is a real device, never a missing value. IDs are never reissued.
Keep the resume token: it is the only way back to the same identity, and a second join without it
allocates a new one. A second socket for one identity closes the first with code **4001**; treat
that code as "opened elsewhere", not as a network error to retry.

`OPERATOR_SECRET` has no default. Unset means every operator request is refused.

Readiness is reported with `device.status` over the bound socket and answered with that device's
own snapshot. A socket may only report for the device it authenticated as. A disconnect clears
that device's claimed readiness, so an operator never reads a vanished phone as audio-ready.

The session starts with a **placeholder show**: one channel, no tracks, no clips, `showRevision` 0.
Team 4's first saved show replaces it wholesale; it is not content to build on.

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

Server surface: `/ws` accepts `clock.probe` and `device.status`. Any other client message returns
a structured `error` with `code: "NOT_IMPLEMENTED"` and `owner: "sync-control"`. A restart mints a
new `serverEpoch` and restores identities from the checkpoint.

## How to run this independently

```bash
bun run dev:sync-demo   # backend on 8080; set OPERATOR_SECRET for the admin snapshot
bun run gate:sync       # contracts, fixtures, boundaries, typecheck, lint, 67 tests, backend build
```

On a machine without Bun on PATH, install the pinned 1.3.14 from `mise.toml` first.

## Pending and blockers

Pending: subscriptions by channel, prepare/ready/commit barriers, scheduled transport, mix and
assignment, uploads and jobs, map commit, panic and audio lease, and the socket load harness.
Team 3 supplies the worker boundary for slice 4.

No unresolved software dependency blocks slice 3. Two coordination items for the captain:
`tools/load/` is not a workspace package and cannot resolve `@orchestra/sync`, so slice 5 will need
a manifest there and a root lockfile update; and `backend/` imports `zod` without declaring it in
its manifest, which currently resolves through the root but should be declared.

Not proven: no phones, no audio, no venue network, no load. The deterministic 10 ms p95 clock
target in masterplan section 8 has not been measured. Passing the gate is not feature completion.
