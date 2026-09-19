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

## Commands and cues

```text
PUT  /api/show        header x-operator-secret   stopped transport only
POST /api/transport   header x-operator-secret   action prepare | play | pause | seek | stop
```

Every command carries `commandId`, `expectedRevision` and the current `serverEpoch`.

1. **`expectedRevision` is the revision of the domain you are changing**, not the snapshot's
   top-level `revision`. A show save names the current `showRevision`; a transport command names
   the current `transportRevision`. The top-level revision moves every time any phone reports its
   status, so comparing against it would refuse every command in a full hall. See the
   [ADR](../../decisions/20260919-112032-sync-control-expected-revision.md).
2. **Saving a show advances the transport revision.** Re-read the snapshot after a save instead of
   reusing the revision you had.
3. **Retry with the same `commandId`** and you get the original result, applied once. Use a new ID
   only when you mean a new command.
4. **A command from a previous epoch is refused** with a retryable `STALE_EPOCH`. Resynchronize and
   reissue rather than retrying blindly.
5. **Cues must be at least 3000 ms in the future** (configurable, `INSUFFICIENT_LEAD_TIME` below
   that). Schedule against `effectiveServerMs` using the estimator's clock, never against arrival.

Starting playback requires a preparation: send `prepare`, let phones answer `transport.ready`
naming that exact `preparationId` with matching show and transport revisions, then send `play`.
Only phones that acknowledged receive the start cue. Stop, pause and seek need no preparation, so a
silent phone can never delay a stop. The server never fires on a timeout; the operator decides when,
and the ready subset is what runs.

A phone that missed a broadcast is not stranded: the same cue is in `pendingActions` in its
snapshot, with the same `effectiveServerMs`.

## Assignments and mix

```text
POST /api/assignments   header x-operator-secret   deviceIds + channelId + mapRevision
POST /api/mix           header x-operator-secret   masterGain + channels
```

Both are scheduled under the same lead-time rule as transport, and both are revision-checked
against their own domain: `expectedRevision` is the current assignment revision or mix revision.

A phone joins a channel only by being assigned to it; membership is server-owned and a phone cannot
subscribe by asking. Each phone is told about its own assignment and nothing else. Unassigning is
explicit (`channelId: null`), and an unassigned device stays silent rather than defaulting to a
channel. Reassigning a device cancels only that device's pending change: other devices in an
earlier command stay scheduled. Last committed assignment wins for overlapping selections.

A mix change lands on channel gain, mute and solo without touching clip timing, and never cancels
an accepted transport cue: the domains are independent.

`mapRevision` is 0 until Team 3 commits a real map. The stale-map check is live now, so selections
built against an old map will start being refused as soon as map commits exist.

## Two open contract gaps for the captain and Team 4

Both concern what the operator can see, and neither blocks the server.

1. **Preparation counts have nowhere to go.** The server tracks ready, expected and excluded per
   preparation, but `AdminSnapshot` has no field for it, so the console cannot show "1,420 ready,
   80 not answering" — the number the operator needs before firing a cue.
   [ADR](../../decisions/20260919-114500-sync-control-preparation-counts.md).
2. **Effective master gain has nowhere to go.** `MixRequest` and the mix pending action carry it,
   but once applied there is no field in the snapshot. Channel gains are fine; they live on
   `Show.channels`. A phone that reconnects after a mix change cannot recover the master gain.

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
