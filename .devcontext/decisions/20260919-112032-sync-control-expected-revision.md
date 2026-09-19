# expectedRevision names the domain being changed, not the whole session

Date / author / team: 2026-09-19 / Team 1 sync-control / Hansen Cheng with Claude
Status: proposed
Affected teams: sync-control (producer), admin-console and audio-client (consumers)
Supersedes / superseded by: none

## Context

Every operator mutation carries `CommandContext.expectedRevision`, and the server refuses a
command whose expectation does not match reality. The contract does not say which revision that
field means, and two readings are possible.

Snapshots also carry a session-wide `revision`, which increases on **every** state change. Device
readiness is state: with 1,500 phones reporting connection, clock quality, foreground and audio
state, that counter moves constantly.

If `expectedRevision` meant the session-wide revision, then in a full hall an operator command
would be built against a revision that is already stale by the time the request arrives. Every
command would be refused, and the only way to make the console usable would be to stop checking.
The check that exists to prevent overwriting newer state would instead be the reason it gets
disabled.

## Decision

`expectedRevision` is the current revision **of the domain the command changes**:

| Command | `expectedRevision` compares against |
| --- | --- |
| `PUT /api/show` | current `showRevision` |
| `POST /api/transport` | current `transportRevision` |
| `POST /api/assignments` | current session assignment revision |
| `POST /api/mix` | current `mixRevision` |

Domain revisions change only when that domain changes, so telemetry churn cannot invalidate an
operator's command. The session-wide `revision` keeps its existing job: it tells a consumer whether
a snapshot it holds is older than one it just received. It is never what a command is compared to.

`AssignmentRequest.mapRevision` is a separate, additional check: an assignment built from a stale
audience map is refused even when the assignment domain itself has not moved.

The server assigns `showRevision` on save. A client cannot choose its own revision number.

## Alternatives and consequences

**Session-wide revision.** Simplest to describe and unusable at concert scale, for the reason above.

**No revision check, last writer wins.** Removes the conflict entirely and with it the protection
against two operators overwriting each other. The masterplan requires consumers to reject stale
state, so this contradicts the plan.

**Consequences.** Team 4 must read the domain revision out of the snapshot it is acting on, not the
top-level `revision`. A conflict response names the current domain revision so the console can
refresh and let the operator reselect rather than retry blindly. Tests cover a stale domain
revision being refused, and readiness churn *not* invalidating a pending operator command.

No schema change: this fixes the meaning of an existing field. If a consumer has already built
against the other reading, that is a breaking behavior change and needs to be raised before merge.
