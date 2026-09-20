# Manual section routing follow-up

Owner: integration captain, `main`. Baseline: `a29625e` (all preceding playback fixes committed and pushed to origin/main before this work).

## Request and findings

A participant's `participant.column` message changed only its coarse location. It never assigned a channel. A second independent issue kept a phone excluded from the original Play recipient set even after it became ready to join.

The user confirmed defaults of left → Melody, center → Vocals, right → Percussion. Existing operator section assignments take precedence. Channel IDs are not positional: the current live show uses legacy IDs, so resolve defaults by musical label. Coordinates remain null and evidence remains manual.

## Plan / acceptance

- Server-owned manual routing: derive a section's unique most common operator-assigned channel; use the agreed musical default if there is no unique winner. Automatically routed phones must not vote themselves into a circular/stale section mapping. Explicit operator assignments/clears override automatic following.
- Schedule routing at a future time (two seconds for a participant choice), persist it, and preserve automatic-follow ownership across restart. Existing unassigned manual locations are repaired without changing explicitly cleared assignments.
- A manually located phone may join the current playing transport after foreground, clock, audio and channel hashes are ready. The client retains its stricter warmed-output/fresh-clock gates and computes a future rendezvous at the current playhead. Pause/panic must remain silent; other excluded phones remain excluded.
- Verify regression tests first, then focused sync/client gates and isolated real HTTP/WebSocket E2E. Do not use or reset the live show for tests. Record physical audio checks separately.

## Progress

- Read-only live snapshot: saved show revision 3, six identities/four connected, transport paused, map revision 2. No live mutation performed.
- The three initial regressions failed before implementation: no assignment on choice, no matching section route, and a ready late phone still seeing stopped transport. All now pass.
- Backend routing uses existing operator assignments and the confirmed label-based defaults. Automatic following is persisted separately from explicit overrides; original coordinates/evidence are unchanged. Snapshot admission fixes late manual playback without admitting other excluded phones.
- Focused client gate passed: 143 tests, 14 contract tests, boundary/schema/fixture checks, typecheck/lint and production Next build. The real playback engine test verifies the Vocal buffer, a nonzero shared playhead offset, the output warmup gate and lease, no restart on duplicate snapshots, and silence after panic.
- Isolated real HTTP/WebSocket/Python E2E passed with an additional fifth phone choosing Center during playback. It stayed excluded while sound was unready, then received Vocals and the same running transport; assignment/location survived restart. Generated camera footage and the audio recording double are software evidence, not physical device/audio measurements.
- Final backend gate passed: 229 tests, 14 contract tests, schema/fixture/boundary checks, typecheck/lint and backend build. Additional regressions cover section rescheduling and join waves so automatic followers neither switch early nor have their deadlines postponed by later joins.

## Runtime / handoff

- Confirmed stopped transport, zero pending cues, no active calibration and no connected phones before replacing the owned local service tree. The stage session was independently reset during development: the actual pre-restart checkpoint contained the saved show and zero identities. It was backed up under ignored `runtime/local/manual-routing-before-restart.checkpoint.json`; the new backend restored that exact saved show. Fresh audience joins then populated the session normally. An initial whole-snapshot comparison correctly detected this concurrent audience change; comparison against the actual checkpoint and startup log confirmed the restore.
- Updated hidden service runner PID 40964; backend 38680, audience Next 38948, admin Next 12640. Cloudflare was left running. New epoch at verification: `5bf22a5b-21da-41f6-90a9-092190d9e5f2`. These values are observations, not configuration.
- Local `/` and `/admin` and public `https://htn.nicholasching.ca/` return 200. The public authenticated operator snapshot and WSS clock round trip pass without allocating test audience identities. Existing show revision 3 retained. Do not reset the event session for further testing.
- The prior checkpoint `a29625e` is pushed. This manual-routing follow-up is a new, uncommitted working-tree change, ready for user testing. No changes to the reference tree, wire schemas, lockfile or the other four worktrees.
- Next physical check: after calibration, choose a section on an unmapped phone, check its displayed musical part, and listen while starting and while joining an already running show. Software tests establish routing/timing logic; speaker output and venue synchronization still require the physical phones.
- Live show content check: Melody and Vocals each contain one clip; Percussion has zero clips. A phone routed to Percussion correctly remains silent until the operator adds a percussion clip or assigns that section to a populated channel. No music or lane contents were changed as part of the routing fix.
