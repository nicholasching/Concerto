# sync-control session: identity registry and role-filtered snapshots

Agent: Claude (Opus 5) with Team 1 human lead. Date: 2026-09-19.
Branch: `feat/sync-control`. Baseline for this slice: `397319a` (slice 1), on `foundation-v1`.
Owned files this session: `backend/`. `packages/sync/` and `tools/load/` untouched.
Continues [the clock estimator session](20260919-102847-clock-estimator.md).

## Goal

Stage 01 slice 2: an authoritative device registry with authenticated resume, a capacity limit,
one socket per identity, a durable checkpoint that survives restart, and role-filtered snapshots
that give a participant its own state and an operator the whole session.

## Subplot: slice 2 (awaiting lead approval before implementation)

The frozen contract already fixes the shapes: `JoinRequest`/`JoinResponse`, `DeviceReadiness`,
`Assignment`, `Location`, `AdminSnapshot`, `ParticipantSnapshot`. No schema change is proposed.
Three of those shapes force design decisions, listed under open decisions below.

### Step 2A - registry, join, resume, durability

`backend/src/registry.ts`: one authoritative writer owning identity state.

- Device IDs are allocated sequentially from **0**, never recycled within a session. Zero is a
  valid ID and must never read as missing.
- Capacity is 2048 (IDs 0 through 2047). The 2049th join is rejected with a structured error;
  the counter never wraps.
- Join with no token allocates a new identity and returns an opaque `resumeToken` of at least 16
  characters, generated from `crypto.randomUUID()` and stored hashed, not in clear text.
- Join with a valid token returns the same `deviceId`. Join with a token that does not match its
  device is rejected and allocates nothing; a client can never claim an ID by number alone.
- `POST /api/sessions/:sessionId/join` replaces the 501 for that path only. A wrong `sessionId`
  in the path is rejected.

`backend/src/checkpoint.ts`: durable identity state.

- Serialized writes to a single local JSON file, written to a temporary path and renamed, so a
  crash mid-write cannot leave a partial file. Acknowledge a durable mutation only after the
  rename succeeds.
- Clock probes, heartbeats and readiness updates are **not** persisted.
- On restart: restore identities and their resume tokens, mint a **new** `serverEpoch`, clear all
  pending actions, and return transport to stopped. A resumed client re-probes before it is ready,
  which the slice 1 estimator already does when it sees a new epoch.

Tests: ID 0 is allocated first and survives a round trip; sequential allocation with no reuse
after a device leaves; capacity rejection at 2049 with no wrap; resume returns the same ID;
a forged or mismatched token is rejected; a second join without a token gets a different ID;
restart restores identities, changes the epoch, and clears pending state; a truncated checkpoint
file is rejected rather than silently starting empty.

### Step 2B - socket binding, role filtering, readiness

- A participant socket authenticates with its resume token and is bound to that device. Messages
  are attributed to the bound device, never to a device ID carried in the payload.
- A new authenticated connection for an identity **replaces** the previous one: the old socket is
  closed with a stated reason. This is the concurrent-tab rule from masterplan section 4.
- `device.status` updates that device's `DeviceReadiness`. Connection, clock, foreground,
  audio-unlocked and decoded-assets states are tracked separately and never collapsed into one
  "ready" boolean.
- `GET /api/sessions/:sessionId/snapshot` and the `state.snapshot` message are role-filtered:
  a participant receives its own readiness, assignment and location plus shared show/transport
  state; an operator receives the device list, assignments and the audience map. A participant
  never receives another phone's telemetry.
- Operator telemetry is aggregated to roughly one to two updates per second rather than
  broadcast per probe or join.

Tests: a participant snapshot contains only its own device and omits the registry; an operator
snapshot contains all devices; a socket cannot act for a device it is not bound to; a replaced
connection stops receiving state and the newest connection receives it; readiness fields move
independently; snapshot revision increases monotonically and a consumer can reject a stale one;
the aggregated telemetry path does not emit one message per probe.

### Verification

`bun test backend/tests`, then `bun run gate:sync`. Plus a manual restart check: join two devices,
restart the process, resume both, and confirm the IDs are unchanged and the epoch is new.

### Out of scope

Prepare/ready/commit barriers, transport, mix, assignments as scheduled operations, uploads, jobs,
map commit, panic, audio lease, and the load harness. Those are slices 3 through 5.

### What this slice will not prove

Nothing physical. No venue network, no real phones, no concurrent-client load. The capacity limit
is tested by allocation, not by 2,048 live sockets.

## Decisions taken by the lead

1. **Operator credential: a shared secret from the environment**, sent as a request header and
   compared in constant time. One secret per session, no accounts, no login flow. Lands in 2B with
   the admin snapshot.
2. **Bootstrap show: a placeholder.** The session starts at `showRevision` 0 with one channel, no
   tracks and no clips, so snapshots are answerable before any music exists. Team 4's first
   `PUT /api/show` replaces it wholesale. Flagged to Team 4 in the handoff so an obviously empty
   placeholder is never mistaken for real content.
3. **Checkpoint location:** a path from the environment defaulting to the gitignored
   `runtime/checkpoint.json`, so durable state is never committed and worktrees stay separate.
4. **Join rate limiting: global, not per address.** See the finding below; the subplot originally
   proposed a per-address limit and that would have been actively harmful.

## Progress

- Subplot written and approved; the lead chose the shared operator secret and the placeholder show.
- Step 2A implemented: `backend/src/registry.ts`, `backend/src/checkpoint.ts`,
  `backend/src/rate-limit.ts`, the join route in `app.ts`, and restore-on-start in `index.ts`.
  `createApp()` now takes its dependencies, so tests can place the session anywhere in time.
- Step 2B not started.

### Finding: a per-address join limit would have throttled the venue

The subplot proposed limiting joins per client address. An auditorium is behind one NAT, so
1,500 phones share a handful of addresses and the limiter would have shed legitimate joins during
exactly the join wave it was meant to survive. Implemented a single global token bucket instead,
capacity 300 and 200 per second, which is above a realistic wave. These numbers are a guess until
slice 5 measures a real one; they are constants in `rate-limit.ts` with that written next to them.

### Checks run

- `bun test backend/tests` - 23 pass, 0 fail.
- `bun run gate:sync` - PASS. 53 tests across backend, sync and testkit; backend bundle built.
- Manual restart procedure from this subplot, run against the real server on 8080:
  joined two devices (IDs 0 and 1), killed the process, started it again. The new process logged a
  new `serverEpoch` and 2 restored devices. Resuming with each stored token returned the same IDs
  0 and 1; a fresh join returned 2, not a recycled ID; a forged token returned 401
  `INVALID_RESUME_TOKEN`. Single machine, loopback, no concurrency.

### Failure encountered

The first restart attempt reported success against stale code: a backend process left over from the
slice 1 live check still held port 8080, the new process failed to bind with `EADDRINUSE`, and the
join calls were answered by the old build returning `NOT_IMPLEMENTED`. The log made it visible.
Freed the port and reran. Worth remembering: a manual check that talks to a port proves nothing
unless the process answering it is the one just built.

### Step 2B implemented

- `backend/src/state.ts`: `SessionState` owning readiness, assignments, locations, the revision
  counter and both snapshot builders. The placeholder show and a stopped transport live here.
- `backend/src/connections.ts`: `ConnectionRegistry` (one socket per identity, operator set) and
  `OperatorTelemetry` (coalescing).
- `backend/src/auth.ts`: constant-time operator secret comparison, injected rather than read from
  the environment inside a route, so tests do not mutate process state.
- `backend/src/messages.ts`: `handleClientMessage` moved out of `clock.ts`, which no longer
  matched its contents, and extended with `device.status`. `clock.ts` now only creates the clock.
- `GET /api/sessions/:sessionId/snapshot` with role filtering; `/ws` now authenticates at upgrade.

Decisions taken while implementing:

1. **Sockets authenticate at upgrade via a query parameter**, because the frozen `ClientMessage`
   union has no authentication message and browsers cannot set headers on a WebSocket handshake.
   A token in a URL can end up in logs, so the server does not log request URLs. Revisit if a
   proxy in the venue logs query strings.
2. **A dropped connection resets that device's claimed readiness** rather than leaving the last
   values in place. A phone that vanished is not still audio-unlocked, and an operator deciding
   who is ready must not read a stale claim as current.
3. **`device.status` is answered with that participant's own snapshot**, giving the client its
   revision without a second round trip. The contract has no generic acknowledgement message.
4. **Breaking change for slice 1 consumers:** `/ws` now requires a valid resume token, so a client
   must join over HTTP before probing. Recorded in the handoff.

### Checks run

- `bun test backend/tests` - 37 pass, 0 fail.
- `bun run gate:sync` - PASS, 67 tests across backend, sync and testkit; backend bundle built.
- Live end-to-end against the running server with `OPERATOR_SECRET` set: two devices joined (0 and
  1); a socket with no token was refused; a coded probe pair returned two `clock.reply` messages and
  one accepted measurement; `device.status` returned a `state.snapshot`; the same socket reporting
  for the *other* device was refused with `DEVICE_MISMATCH`; the participant view returned only its
  own state with no device list present; the operator view returned both devices with correct
  per-device readiness; an anonymous request and a participant token presented as the operator
  secret both returned 401; a second socket for the same identity closed the first with code 4001.

### Failure encountered

The live check first reported that the replacement socket had not displaced the original. The
cause was in the check, not the server: it attached the close listener after awaiting the new
connection, so a prompt close arrived before anything was listening. Attaching the listener first
showed close code 4001 as designed. Worth keeping in mind for every later reconnect test: an
event-ordering mistake in a harness looks exactly like a missing server behavior.

### Typecheck note

`Bun.serve`'s second type parameter is the route-path string, not a record. The first attempt
failed `tsc` with a constraint error, which the gate caught before commit.

## Next action

Slice 3: assignments, assets, calibration, transport and mix as prepare/ready/commit barriers with
revisions, idempotent commands and future execution times. Write its subplot before implementing.
Slices 2 and 1 are ready for Teams 2 and 4 to consume.
