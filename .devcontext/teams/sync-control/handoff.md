# sync-control handoff

Status: all five Team 1 software slices implemented on `feat/sync-control`; integration and
physical acceptance remain. Read the [stage brief](../../stages/01-sync-control.md), root
rules/masterplan and the linked ADRs before changing behavior.

## Join, resume and socket identity

```text
POST /api/sessions/<sessionId>/join      body {} or { "resumeToken": "..." }
ws://<host>:8080/ws?resumeToken=<token>  participant socket
ws://<host>:8080/ws?operatorSecret=<secret> operator socket
GET /api/sessions/<sessionId>/snapshot
```

Device IDs start at **0**, are never recycled in a session and stop at 2048. Resume credentials
are stored as hashes. A second authenticated socket for one identity closes the first with code
4001. Participant snapshots contain only that device; operator snapshots require
`x-operator-secret`. `OPERATOR_SECRET` has no default: unset refuses every operator request.

The checkpoint is atomic and carries identities, the show and the committed audience map. A
restart restores those durable values, mints a new `serverEpoch`, clears pending actions and starts
stopped. A corrupt or older checkpoint fails loudly instead of reissuing live identities.

## Clock consumer surface

`@orchestra/sync` exports `ClockEstimator`, `PROBE_CONSTANTS` and `epochNow`. The estimator is
per-client and transport/React/audio independent.

```ts
const estimator = new ClockEstimator();
const probeGroupId = estimator.beginProbeGroup();
// Send clock.probe indexes 0 and 1 PROBE_CONSTANTS.PROBE_GAP_MS apart.
estimator.accept({ serverEpoch, ...reply.payload });
estimator.nowServerMs();
estimator.toLocalPerformanceMs(serverMs);
estimator.quality();
estimator.waitTimeMs(effectiveServerMs);
```

Stamp `t0` when sending. Passing every reply's `serverEpoch` to `accept()` is what discards samples
from a previous server run. `quality().ready` requires 16 measurements, uncertainty at or below
20 ms and a sample no older than 3750 ms. Uncertainty is half the best observed round trip under
the symmetric-delay assumption; it is not proof of acoustic accuracy. Do not put an audio nudge
inside the clock conversion.

## Commands, cues, assignments and mix

```text
PUT  /api/show
POST /api/transport       prepare | play | pause | seek | stop
POST /api/assignments
POST /api/mix
POST /api/panic
```

All operator routes require `x-operator-secret`. Mutation retries reuse the same `commandId` and
return the original result once. Except for panic, stale epochs and stale domain revisions are
refused. `expectedRevision` means the revision of the domain being changed, not the snapshot's
top-level telemetry revision; see the
[ADR](../../decisions/20260919-112032-sync-control-expected-revision.md).

Normal changes need at least 3000 ms lead time. Play requires a transport preparation, and
`transport.ready` must name that exact preparation, show revision and transport revision. The
operator decides when to run the ready subset; the server never fires on a timeout. Stop, pause and
seek do not wait on a silent phone. A missed broadcast is recoverable from the identical pending
action in a fresh snapshot.

Membership is server-owned. A phone changes channel only through its authorized assignment and
receives only its own assignment. Pending assignments are tracked per device; replacing one does
not cancel the rest of an earlier selection. Transport, mix and assignments are independent
pending domains.

## Assets, calibration, jobs and map commit

```text
POST /api/assets
GET  /api/assets/<trackId>
POST /api/calibrations
POST /api/calibrations/<runId>/arm
POST /api/calibrations/<runId>/uploads
POST /api/calibrations/<runId>/jobs
GET  /api/jobs/<jobId>
DELETE /api/jobs/<jobId>
POST /api/calibrations/<runId>/commit-map
DELETE /api/calibrations/<runId>
```

Uploads stream to temporary files, hash the bytes that arrived and rename only after completion.
Client labels never become paths. Calibration freezes the connected participant set and allocates
a run tag that is never reused in the session. At most three camera recordings are accepted, one
per camera.

The OTC worker is spawned with an argument array, never a shell command. Jobs are serialized,
bounded by a timeout and cancellable. A result must match the manifest's session, run, run tag and
every camera hash before it is stored, and identity is checked again at commit. Team 3 replaces
the synthetic load fixture by setting `OTC_COMMAND` to the real CLI.

Map commit replaces only the targeted devices. A targeted phone the decoder could not locate is
`unseen`, never `(0,0)`; devices outside the run keep their old locations. Older runs and stale
`expectedMapRevision` values are refused. Committing a map intentionally makes earlier selections
stale. `DELETE /api/calibrations/<runId>` frees an uncommitted failed run; a committed run cannot be
discarded while its map is in use.

## Panic and the audio lease

Panic is immediate: no lead time, no preparation, and no revision/epoch reload requirement. It
cancels every pending action, stops transport, broadcasts `panic` and sends an already-expired
lease. Only a wrong session or missing operator secret can block it.

**Team 2 must enforce the lease.** The server sends `lease.renew` every second with an expiry five
seconds ahead. A phone compares it against its synchronized clock and mutes itself once it passes,
without waiting for JavaScript control or another network message. This is what silences a phone
that cannot receive panic because its network disappeared. A deliberate new transport command
resumes lease issuance after panic.

## Verification

```bash
bun run gate:sync
bun test tools/load/tests

# Backend terminal for the repeatable synthetic contention run:
OPERATOR_SECRET=<secret> \
  OTC_COMMAND="bun tools/load/worker-fixture.ts" \
  bun run backend/src/index.ts

# Load terminal:
OPERATOR_SECRET=<secret> \
  bun run tools/load/index.ts --clients 1500 --duration 300
```

The focused gate currently passes 185 tests; the load metrics add 7 tests. The five-minute load
report is [load-1500.md](../../evidence/sync-control/load-1500.md). The worker fixture is explicitly
synthetic and CPU-active: it tests process contention and boundary validation, not optical
decoding.

## Captain actions and known limits

1. `tools/load/` is not a workspace package, so it imports `packages/sync` relatively. The captain
   should add the workspace/root `test:load` script and lockfile change, then include
   `tools/load/tests` in `gate:sync`.
2. `backend/` uses `zod` directly but does not declare it in its manifest; fix this in the
   captain-owned lock/config change.
3. Preparation ready/expected/excluded counts have no field in `AdminSnapshot`; see the
   [ADR](../../decisions/20260919-114500-sync-control-preparation-counts.md). Effective master gain
   and upload receipts also lack durable/shared contract fields. Team 4 cannot render those
   honestly until the contracts owner resolves them.
4. Team 3 still has to supply and verify the real OTC CLI. The load fixture is not a decoder.

Not proven by this branch: phone audio, browser scheduling, physical clock/acoustic accuracy,
camera visibility, the real decoder, venue Wi-Fi/HTTPS/WSS reachability or hardware panic/lease
behavior. Loopback sockets are server-capacity evidence only. Do not present them as a phone or
venue rehearsal.
