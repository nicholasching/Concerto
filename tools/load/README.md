# Control load harness - Team 1

Opens N simulated phones against a running backend and drives the concert shape: a join wave, coded
clock probes through the real estimator, readiness reports, a prepared and scheduled cue, a
reassignment, and reconnects, while an asset upload competes for the machine.

```bash
OPERATOR_SECRET=<secret> \
  OTC_COMMAND="bun tools/load/worker-fixture.ts" \
  bun run backend/src/index.ts                              # in one terminal
OPERATOR_SECRET=<secret> bun tools/load/index.ts --clients 1500 --duration 300
```

The committed worker fixture deliberately burns CPU in a separate process and writes a
schema-valid result labelled `synthetic`. It exists only to make upload/worker contention
repeatable during the load run. It does not decode video and is not optical evidence. Point
`OTC_COMMAND` at Team 3's real CLI when it is available.

Options: `--clients`, `--duration` (seconds), `--url`, `--session`, `--report` (output path).
The report lands under `.devcontext/evidence/sync-control/` by default.

## What it measures

Cue acknowledgements received before the deadline as a fraction of clients that joined, how many
clients knew about the cue at all (by broadcast or by recovering it from a snapshot), cue warning
margin, join latency, rate-limiter shedding, and event-loop delay sampled **inside** the control
process and read back from `/api/foundation`. Delay measured from a client cannot tell a busy server
apart from a slow network, which is why the server samples its own timer drift.

Rates are always printed with both counts. A bare percentage hides its denominator, and the
denominator is where an excluded part of the room goes missing.

## What it does not measure

Every client is a loopback socket on the same machine as the server. This says nothing about venue
Wi-Fi, radio congestion, access-point NAT tables, phones sleeping or backgrounding, or whether any
sound was produced. No audio is played and no screen is rendered. A passing run is a necessary
condition for the concert, not evidence that it will work.

## Notes for whoever picks this up

- The estimator is imported by relative path because `tools/` is not a workspace and
  `@orchestra/sync` does not resolve here. Adding it changes the root manifest and lockfile, which
  belong to the captain.
- `tools/load/tests/` is not in `gate:sync` yet. Run it with `bun test tools/load/tests`, and ask the
  captain to add the directory so it cannot rot.
- A root `test:load` script still needs the captain; the masterplan names it as Team 1's to define.
