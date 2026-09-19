# sync-control session: commands, preparation barriers and scheduled execution

Agent: Claude (Opus 5) with Team 1 human lead. Date: 2026-09-19.
Branch: `feat/sync-control`. Baseline for this slice: `9bcae3f` (slice 2), on `foundation-v1`.
Owned files this session: `backend/`.
Continues [the registry session](20260919-105418-registry-snapshots.md).

## Goal

Stage 01 slice 3: the machinery that makes a cue happen at the same moment everywhere. Operator
commands are validated, idempotent and revision-checked; phones acknowledge a named preparation;
the server commits a future execution time; and a phone that missed a broadcast recovers the same
truth from a snapshot.

This is the slice the concert depends on. Everything before it was plumbing.

## The four properties this slice has to get right

1. **Receipt time is never execution time.** A command carries `effectiveServerMs`, a future
   moment in the current epoch. Phones schedule against their synchronized clock, not against
   the instant a message arrived.
2. **A retry is not a second command.** The same `commandId` returns the same result and changes
   nothing further. An operator tapping twice, or a proxy retrying, must not double-apply.
3. **Stale things lose.** A command carrying a stale `expectedRevision` is refused rather than
   silently applied over newer state. An acknowledgement naming an old preparation cannot satisfy
   the current barrier.
4. **Missing a broadcast is survivable.** Effective state and pending actions both appear in the
   snapshot, so a phone that reconnects mid-cue lands in the same place as one that never dropped.

## Subplot: slice 3, in three reviewable steps

The contract already fixes every shape involved: `CommandContext`, `CommandAccepted`,
`PendingAction`, `TransportRequest`, `AssignmentRequest`, `MixRequest`, `SaveShowRequest`, and the
`*.prepare` / `*.ready` / `*.commit` messages. No schema change is proposed.

### Step 3A - commands, revisions, idempotency

`backend/src/commands.ts`: one path every operator mutation goes through.

- Reject a command whose `expectedRevision` is not the current revision, with a structured
  conflict error naming the current one, so the operator reselects rather than overwrites.
- Remember each `commandId` with the result it produced. A repeat returns that same result without
  re-applying. Retained for the whole session, capped at a fixed number of entries as a safety
  valve rather than growing without limit.
- `PUT /api/show` saves a show revision while stopped, replacing the placeholder. Refuse a show
  change while the transport is not stopped.

Tests: a stale revision is refused and state is unchanged; the same command ID twice applies once
and returns the same revision; a different command ID with the same content applies twice; a show
save while playing is refused; the placeholder is replaced, not merged.

### Step 3B - preparation barriers and scheduled transport

`backend/src/barriers.ts` and transport handling.

- A preparation gets a fresh `preparationId`. `assets.prepare` and `transport.prepare` carry it to
  the devices that must answer. Only an acknowledgement naming that exact preparation, with the
  matching show revision and asset hashes, counts. An ACK naming a previous preparation is ignored,
  not counted late.
- The server tracks ready, expected and excluded counts and exposes them to the operator. It never
  fires on its own: the operator commits, and may commit with the ready subset. One slow phone
  cannot hold the show, and no phone is counted ready because it merely holds a socket open.
- Commit schedules `effectiveServerMs` at least a configured lead time in the future, measured
  from when preparation became ready, and broadcasts `transport.commit`. The pending action is in
  the snapshot from that moment.
- The admin is never counted as an audio-ready phone.

Tests: an ACK for a superseded preparation does not count; a device that never answers is reported
excluded rather than blocking; commit with a ready subset succeeds and names who was excluded; a
commit time in the past or in a previous epoch is refused; a client that misses the broadcast finds
the same pending action in its snapshot; the pending action becomes effective state at its time.

### Step 3C - assignments, channel membership and mix

- Channel membership is server-owned. A phone belongs to a channel through a committed assignment
  and cannot subscribe to another by asking; a cue for a channel reaches only its members.
- One pending assignment change per device and one pending transport change, per the MVP rule.
  Replacing within a domain explicitly cancels the prior pending change and records the superseded
  command ID. A mix change must not cancel an accepted transport start.
- `mix.commit` schedules gain, mute and solo without touching asset timing.
- An assignment naming a stale `mapRevision` is refused so the operator reselects.

Tests: a phone cannot receive another channel's cue; last committed assignment wins for overlapping
selections at the same effective time; a newer mix does not cancel a pending transport start; a
replacement within one domain cancels exactly one pending action and names it; a stale map revision
is refused.

### Verification

`bun test backend/tests`, then `bun run gate:sync`. Plus a live multi-client script: three sockets
on two channels, a scheduled cue, one client held silent to prove exclusion, and one client
reconnecting mid-cue to prove snapshot recovery. Deterministic simulation on one machine, not
evidence about phones.

### Out of scope

Uploads, jobs, map commit, panic, audio lease and the load harness stay in slices 4 and 5.
Calibration barriers reuse this machinery and follow once transport is proven, to keep each step
reviewable.

### What this slice will not prove

That any of this is audible. It schedules a moment and proves the state machine around it. Whether
1,500 phones actually emit sound together is a physical measurement nobody has taken.

## Decisions taken by the lead

1. **The operator decides when a cue fires.** The server never fires on a timeout. It reports
   ready, expected and excluded counts and waits for an explicit commit, which may run the ready
   subset. "Most phones are ready" is a judgement someone in the room makes, not a timer.
2. **Lead time is configurable with a three-second default**, and a commit closer than that is
   refused. The configured value goes in the handoff so Team 2 schedules against the same number.

## Progress

- Subplot written and approved. Step 3A implemented. Steps 3B and 3C not started.

### Decision that needed an ADR: what `expectedRevision` compares against

Implementing the revision check surfaced a contract ambiguity serious enough to stop and write it
down: [expectedRevision names the domain being changed](../../decisions/20260919-112032-sync-control-expected-revision.md).

The session-wide `revision` moves on every state change, and device readiness is state. With a hall
full of phones reporting connection and clock quality, an operator's command would always name a
revision that was stale by the time it arrived, so every command would be refused. The check meant
to prevent overwriting newer state would have become the reason someone disabled it.

`expectedRevision` therefore compares against the revision of the domain the command changes:
`showRevision` for a show save, `transportRevision` for transport, and so on. The session-wide
revision keeps its job of telling a consumer which snapshot is newer. Team 4 must read the domain
revision out of the snapshot rather than the top-level one; this is in the handoff and the ADR is
marked proposed until they confirm.

### Step 3A implemented

- `backend/src/commands.ts`: `CommandLog`, a bounded map of command results for idempotent retries.
- `backend/src/state.ts`: the show is now mutable state with a server-assigned revision, and the
  transport follows it. The placeholder is returned until a real show is saved and is never
  persisted.
- `backend/src/checkpoint.ts`: version 2 carries the saved show. An unreadable or older file throws
  with a message naming the path, rather than starting empty and reissuing device IDs.
- `PUT /api/show`, operator-only, stopped-transport-only, revision-checked and idempotent.

The idempotent replay check runs **before** validation, so retrying a command that already
succeeded returns its original result even though the revision it expected has since moved on.

### Checks run

- `bun test backend/tests` - 47 pass, 0 fail.
- `bun run gate:sync` - PASS, 77 tests across backend, sync and testkit; backend bundle built.
- A test specifically covers the ADR's motivation: readiness churn advances the session revision,
  and an operator command naming the unchanged show revision still succeeds.

### Failure encountered

`tsc` rejected an untyped `CommandLog.get` call in a test where the generic defaulted to `unknown`.
Caught by the gate before commit. Typed the call rather than loosening the signature.

### Step 3B implemented

- `backend/src/barriers.ts`: a `Barrier` per preparation, holding expected, ready and excluded sets.
- `backend/src/preparations.ts`: one active preparation per domain. Starting a new one discards the
  old barrier, which is precisely what stops a late acknowledgement from satisfying the current one.
- `backend/src/transport.ts`: the transport state transitions, with `startServerMs` always the
  scheduled future moment.
- `backend/src/state.ts`: pending actions per domain, and `applyDue(now)` promoting a pending action
  when its moment arrives. Called by the scheduler interval and before each command.
- `POST /api/transport` with prepare, play, pause, seek and stop.

Decisions taken while implementing:

1. **Only `play` is gated on readiness.** Stop, pause and seek schedule directly. Requiring a
   barrier before stopping would mean a phone that is not answering could delay a stop, which is
   the opposite of what a stop is for.
2. **All transport changes are scheduled, including stop.** One rule to reason about, and a stop
   lands at the same moment everywhere rather than smearing across the hall. Panic, which is
   immediate by design, arrives in slice 5 and is deliberately a different mechanism.
3. **A command from a previous epoch is refused** with a retryable `STALE_EPOCH`. Its effective
   time was computed against a clock origin that no longer exists.
4. **Saving a show advances the transport revision**, because the transport now points at a new
   show revision. An operator must re-read after saving rather than reusing the revision it had.
   Recorded in the handoff; this caught out my own live check before it caught out Team 4.

### Checks run

- `bun test backend/tests` - 68 pass, 0 fail.
- `bun run gate:sync` - PASS, 98 tests across backend, sync and testkit; backend bundle built.
- Live end-to-end against the running server, two phones with sockets: show saved; prepare
  delivered `transport.prepare` to both; only Alice acknowledged; a cue 500 ms out was refused with
  `INSUFFICIENT_LEAD_TIME`; a cue 4 s out was accepted; `transport.commit` reached Alice and not
  silent Bob; Bob's snapshot still contained the pending cue with the same effective time; after the
  moment passed the transport was playing with `startServerMs` exactly equal to the scheduled time
  and the pending action cleared. Loopback, one machine, no audio.

### Failures encountered

- The live check sent `expectedRevision: 0` for the transport after saving a show, and the server
  refused it. The server was right: the show save had advanced the transport revision. Fixed the
  check to read the current revision from a snapshot. Third harness bug of the day that first
  looked like a server bug.
- `tsc` and ESLint each caught one mistake before commit: a duplicated import introduced by a
  scripted edit, and a type alias left unused after refactoring.

### Known gap, needs a contract decision

The frozen snapshot has nowhere to report ready, expected and excluded counts to the operator.
The server tracks them, but `AdminSnapshot` has no field for them, so Team 4 cannot render
"1,420 ready, 80 not answering" today. The commit path does not need it: the server always runs
the ready subset and the operator decides when. Exposing the counts needs either a field on
`AdminSnapshot` or a new server message, which is a captain-owned contract change and needs Team 4
in the conversation. Raised in the handoff; not invented unilaterally.

## Next action

Step 3C: assignments, server-owned channel membership and mix, including the rule that a mix change
cannot cancel an accepted transport start.
