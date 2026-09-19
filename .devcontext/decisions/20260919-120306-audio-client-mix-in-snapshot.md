# Put the effective mix in the participant snapshot
Date / author / team: 2026-09-19 / Claude agent for Team 2 / audio-client
Status: proposed
Affected teams: captain (contracts), Team 1 (backend), Team 2 (client), Team 4 (admin)
Supersedes / superseded by: none

## Context

`mix.commit` carries `mixRevision`, `masterGain` and per-channel gain/mute/solo. The snapshot shows a mix only while it is pending (`pendingActions`). Once a mix is effective, the snapshot has no `masterGain` or `mixRevision`. Channel settings can live in `show.channels`, but `Show` is an immutable revision. So a phone that reconnects or joins late can't know the operator's current master level, and can't tell whether a later `mix.commit` is newer than what it already has.

Team 2's interim behaviour (subplan 04, user decision): a phone keeps the last master gain it saw during this page load, and uses 1.0 on a fresh load. That can be too loud after a reload if the operator had lowered the master.

## Decision (proposed)

Add an effective mix to the snapshot base (both roles):

```ts
mix: z.strictObject({ mixRevision: Revision, masterGain: z.number().min(0).max(1), channels: z.array(Channel) })
```

- `channels` is the effective per-channel gain/mute/solo. `show.channels` stays the show's saved defaults.
- A pending mix change stays in `pendingActions` as now.
- Clients take `mix` as effective and ignore any `mix.commit` with `mixRevision <= mix.mixRevision`.

## Alternatives and consequences

- **Mutate `show.channels` on each mix change:** this breaks the rule that a show revision is immutable, and it still doesn't carry `masterGain`.
- **Send the current `mix.commit` again after every reconnect:** this relies on the server remembering to do it, and a snapshot is supposed to be complete on its own (masterplan §4: "correctness must not depend on receiving every broadcast").

Migration: this is a required new field, so it is a breaking change to snapshot parsing. The captain updates the Zod schema, the generated JSON Schema and the fixtures together, and runs all consumer gates. Team 1 fills it. Team 2 then uses it instead of the last-known value. Team 4 can show the confirmed mix from it.
