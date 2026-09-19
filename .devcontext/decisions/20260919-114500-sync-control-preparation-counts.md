# Preparation readiness counts have nowhere to go in the frozen snapshot

Date / author / team: 2026-09-19 / Team 1 sync-control / Hansen Cheng with Claude
Status: proposed
Affected teams: sync-control (producer), admin-console (consumer), audio-client (indirect)
Supersedes / superseded by: none

## Context

The masterplan requires that the operator sees ready, expected and excluded counts before a cue,
can postpone, and can explicitly run the ready subset. The lead has decided the server never fires
on a timeout: a human decides when, which only works if that human can see who is ready.

The server now tracks exactly this. Each preparation holds its expected set, the devices that
acknowledged that specific preparation, and the devices excluded with their reasons.

None of it can reach the operator. `AdminSnapshot` carries `show`, `transport`, `pendingActions`,
`audienceMap`, `devices` and `assignments`. There is no preparation in the contract, and no server
message reports barrier state. `DeviceReadiness` describes what a phone claims about itself, which
is not the same question: a phone can be audio-unlocked and clock-ready and still not have
acknowledged this preparation for this show revision.

The commit path does not need this. The server always runs the ready subset and reports exclusions
internally. What is missing is only the operator's view, and the decision to fire is the operator's.

## Decision

Proposed, not yet implemented: add a preparation status to the operator-facing contract, either as

- a `preparations` array on `AdminSnapshot`, each entry naming `preparationId`, `domain`,
  `showRevision`, `transportRevision`, counts, and the excluded devices with reasons; or
- a distinct operator-only server message carrying the same, so the coalesced telemetry stream
  reports it without resending the entire snapshot.

The snapshot field is simpler and already fits the aggregation the operator socket does. The
separate message avoids growing a snapshot that is already the largest payload in the system and
is sent to 1,500 devices in its participant form. Team 4 should choose, since they render it.

`packages/contracts/` is captain-owned, so this needs the captain to make the change and a
regenerated schema and fixtures, with all consumer gates rerun.

## Alternatives and consequences

**Have the console derive it from `devices[]`.** It cannot. Readiness is a phone's self-report, not
an acknowledgement of a named preparation at a named revision. Deriving it would show an operator
a number that looks like consensus and is not.

**Add an operator-only HTTP endpoint outside the contract.** Works today and puts an untyped
surface on the production path that Python never validates and no consumer gate covers. Rejected.

**Ship without it.** The operator fires cues without seeing who will hear them. That defeats the
point of the decision to keep a human in the loop.

**Consequences.** Until this is agreed, Team 4 cannot build the readiness display, and slice 3 is
complete server-side but not demonstrable as an operator workflow. No code depends on the outcome:
the counts already exist behind `Barrier.counts()` and wiring them into whichever shape is chosen
is a small change.
