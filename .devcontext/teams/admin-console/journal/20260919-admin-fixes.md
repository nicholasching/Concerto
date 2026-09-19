# Admin third verification and repairs

Date: 2026-09-19. Owner: Codex / Team 4 admin files. Status: paused at user request.
Baseline: `82cd86f` fast-forwarded from `95189af`; foundation `ab59c27`.

## Assignment and plan

User authorized pulling, verifying, and fixing remaining gaps. Preserve other checkouts, shared contracts/testkit/root configuration and the reference tree. Read root/team instructions, masterplan sections 4/7/8, current architecture/glossary, stage/status/handoff, ADRs and both prior reviews.

1. Verify cancellation, epoch and Undo changes with acceptance assertions. Repair residual race/failure handling and add meaningful gate tests.
2. Finish independent calibration lifetime/retry/error handling, disconnect guards and persistent panic. Remove unsafe invented producer response assumptions; keep shared producer dependencies explicit.
3. Complete independent operator selection/fallback/readiness and scoped timeline controls where frozen schemas allow them. Update stage/status/handoff to current evidence.
4. Run focused tests and root `bun run gate:admin`, inspect rendered operator behavior where tooling permits, and document remaining producer/physical dependencies separately.

## Assumptions and dependencies

- `origin/feat/sync-control` remains foundation-v1 after fetch. No real shared estimator or resource retrieval handoff exists on that ref.
- Asked user asynchronously whether a newer producer branch/handoff is available. Continue independent admin repairs while waiting.
- Do not edit or invent shared wire contracts without owner agreement. Use existing `SynchronizedClock`, calibration/event/result and command schemas at consumer boundaries, with explicit unavailable state where a producer implementation is missing.
- Prior user removed runtime fake harness; tests may inject deterministic dependencies, production must not fabricate success.

## Checks / experiments

- Pulled `82cd86f` and inspected its cancellation/Undo/tab-persistence/terminal-job retry changes. Full verification was not completed and no gate pass is claimed for this session.
- User confirmed there is no newer producer branch/API handoff and requested holding off until the teammate finishes sync/control.
- Preliminary uncommitted edits to the clock helper and a new calibration boundary module were reverted/removed before pausing, leaving application source identical to `82cd86f`. An initial patch attempt was rejected for targeting one file twice; the corrected patch was subsequently reverted as above.
- This journal is the only local addition. No shared files, original OTC checkout, commits, pushes or integration merges were changed.
- Resume when Team 1 publishes the shared clock and calibration resource/result handoff: fetch it, read the approved contracts, verify `82cd86f` and any newer admin fixes, then implement remaining authorized admin repairs and run `bun run gate:admin`.
