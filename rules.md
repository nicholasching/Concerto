# Development rules for all teams and agents

These rules apply to every implementation team in this repository. Read `masterplan.md` for the architecture, four branch assignments, contracts, milestones, and acceptance targets. Follow the user's current instructions and the agreed project scope; do not treat a proposed feature as already implemented.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. Contribution Rules

Commits should be semantic in nature, with labels such as "feat", "fix", "docs", "refactor", and "chore" used to categorize the contribution made by the commit.

Use `type(scope): short imperative description`, for example:

```text
feat(sync): extract BeatSync clock estimation
feat(otc): decode guarded screen symbols
fix(audio): preserve playhead during channel switches
docs(admin): record calibration review handoff
refactor(sync): isolate per-session probe state
chore(contracts): generate Python wire schemas
test(otc): cover occluded and merged screen tracks
```

Keep each commit coherent and reviewable. Include the relevant context/evidence updates with implementation commits. Never commit secrets, machine-specific environment files, dependency folders, raw audience footage, or unrelated assets. Do not claim a commit passed tests that were not run on its code.

## 6. Before starting or resuming work

1. Read `AGENTS.md`, this file, `masterplan.md`, `.devcontext/README.md`, the architecture/glossary, your stage brief, your team's status/handoff, and relevant ADRs. Read only the additional schema/source material needed for the task.
2. Check the active branch/worktree and existing changes. Preserve the user's and other agents' work. Do not reset, stash, overwrite, or reformat unfamiliar changes to make your task easier.
3. Identify your assigned files, producer/consumer interfaces, and one concrete success criterion. Record assumptions, a short plan, and the verification command before implementing.
4. If a shared decision is unclear, pause that dependent change and ask the owning lead with a concrete example/tradeoff. Continue independent work against the frozen fixture. Do not stall an entire branch over a routine implementation choice that the plan already resolves.
5. Re-read current contract versions when resuming after a handoff or context reset. Memory and old chat summaries do not override the committed schemas or a newer approved decision.

The foundation now contains all four stage/status/handoff files. Continue from those checkpoints; create your own dated journal before coding. The captain maintains shared context. Missing context is repaired by its owner, not treated as permission to work without recording it.

## 7. Continuous `.devcontext` documentation

The context directory is shared, committed development memory, following the useful structure of `C:\Projects\Lattice\.devcontext`. It must describe what exists, what was tested, why decisions were made, and what the next agent should do. It is not a dump of chat or an unverified success log.

Required structure:

```text
.devcontext/
  README.md                         # index, current milestone, branch owners, reading order
  architecture.md                   # implemented boundaries and invariants; label proposals
  glossary.md                       # clocks, IDs, tracks, channels, coordinate conventions
  beat-sync-extraction.md           # source-to-destination provenance and retained behavior
  schema/                          # generated-schema locations and semantic notes
    protocol.md
    otc.md
    playback.md
  stages/
    00-foundation.md
    01-sync-control.md
    02-audio-client.md
    03-otc-localization.md
    04-admin-console.md
    05-integration-rehearsal.md
  decisions/
    YYYYMMDD-HHMMSS-<team>-<slug>.md # append-only ADRs; unique across parallel teams
  teams/
    <team>/
      status.md                     # lead-owned current checkpoint
      handoff.md                    # next consumer/agent can act immediately
      journal/
        YYYYMMDD-HHMMSS-<agent>.md   # agent-owned running log for one session
  evidence/
    <team>/                        # small text reports/fixture manifests, not raw footage
```

Team slugs: `sync-control`, `audio-client`, `otc-localization`, `admin-console`. The captain owns shared index/architecture/schema summaries and integration stage; each lead owns its stage/status/handoff. Individual agents write their own journal files to avoid parallel edits to one log.

Update documentation:

- **At session start:** goal, baseline commit/branch, assumptions, owned files, and intended checks.
- **After each meaningful experiment or decision:** result, evidence, failure/limitation, and implication for the next step. Record failed hypotheses too.
- **Before a commit, handoff, pause, or end of session:** current implementation state, exact tests and outcomes, unfinished work, blockers, changed interfaces, and next action.
- **When a cross-team contract or architectural decision changes:** add an ADR and notify affected leads immediately. Do not wait for the feature to finish.

Keep `status.md` short and current; retain history in journals/ADRs. Never replace prior evidence with a new unqualified "all tests pass." Use explicit statuses: `not started`, `in progress`, `blocked`, `ready for integration`, `verified`. "Blocked" requires the named dependency and an owner, not merely a difficult problem.

### Stage/status template

```markdown
# Stage or team name
Status:
Owner / branch / baseline SHA:

## Goal and acceptance criteria
- Observable behavior and pass condition.

## Current state
- Implemented:
- Still proposed or unfinished:

## Assumptions and decisions
- Decision, reason, ADR link if shared.

## Verification
- Command or physical procedure:
- Commit or working-tree state tested:
- Fixture/seed or devices/cameras/OS and input hashes:
- Expected / observed result:
- Date, failures, limitations, evidence path:

## Handoff
- Changed interfaces/files:
- How to run independently:
- Blockers and owning team:
- Exact next action:
```

### ADR template

```markdown
# Decision title
Date / author / team:
Status: proposed | accepted | superseded
Affected teams:
Supersedes / superseded by:

## Context
Concrete problem, evidence, and constraints.

## Decision
Chosen behavior and contract version.

## Alternatives and consequences
Simpler alternatives, tradeoffs, migration and tests needed.
```

Any agent may propose an ADR; affected leads and the captain agree before a shared contract changes. Update status/supersession pointers but preserve historical reasoning. Schema notes link to the executable contract; do not maintain a second incompatible schema in Markdown.

Use synthetic/redacted fixtures in Git. Reference large test files by an ignored local path or approved shared location plus checksum and capture notes. Do not put participant identifiers linked to personal information, credentials, raw network dumps, or unredacted audience images into `.devcontext`.

## 8. Branch ownership and parallel-agent coordination

| Branch | Owner's files |
| --- | --- |
| `feat/sync-control` | `backend/`, `packages/sync/`, `tools/load/` |
| `feat/audio-client` | `client-frontend/`, `packages/audio/`, `tools/client-demo/` |
| `feat/otc-localization` | `workers/otc/`, `tools/otc-fixtures/` |
| `feat/admin-console` | `admin-frontend/`, `packages/selection/`, `tools/admin-demo/` |

The integration captain owns root configuration/scripts, lockfiles, CI, `packages/contracts/`, and `packages/testkit/`. Fixtures have a declared owner in their README. A team may propose dependencies in its own package manifest, but coordinates the root lockfile update with the captain before merging; Team 3 also maintains its Python lock with captain review. No concurrent installations in one checkout or independent package-manager migrations.

- Start branches from the same committed `foundation-v1` baseline. Each working agent uses an isolated worktree or an explicitly disjoint file assignment controlled by its team lead.
- Do not switch another agent's checkout, force-push shared branches, rewrite shared history, or solve conflicts by keeping one side without understanding both.
- Outside your ownership, propose the change and its test to the owner; do not silently edit shared or neighboring implementations. The owner can explicitly transfer a small file/task assignment.
- Merge small working slices. Each slice carries focused checks, a runnable independent demonstration, context updates, and a producer/consumer handoff.
- Use real implementations at integration time. Do not leave mock imports or fake readiness/location state on a production path.
- Use the existing four-team arrangement; do not multiply coordination channels or create extra long-lived integration branches without the leads agreeing it is necessary.

## 9. BeatSync extraction rules

`beatsync-source/` is an unchanged reference supplied by the user. Reused code must live in `backend/`, `client-frontend/`, or the appropriate shared package. Build the new admin UI in `admin-frontend/`.

1. Follow the inspected extraction map in `masterplan.md`. Read the relevant implementation and tests before copying or rewriting it.
2. Extract only required behavior and supporting code. Do not copy the monolithic global store/room manager, unrelated UI, music services, analytics, old geolocation, or arbitrary dependencies wholesale.
3. Record each source path and upstream revision or hash, destination, license, retained behavior, deliberate differences, and ported tests in `.devcontext/beat-sync-extraction.md`.
4. Preserve the full BeatSync MIT notice in the project's third-party notices. Track copied assets separately; the code license is not a blanket assumption about bundled music.
5. Exclude the reference directory from active workspaces, import aliases, build/test globs, deployed assets, and runtime reads. No `../beatsync-source` imports, workspace dependencies, symlinks, or reference-app subprocess dependencies.
6. Test the extracted project from a clean checkout/build context omitting the reference folder. Do not delete the user's supplied copy to perform this test.
7. Preserve a characterized baseline before changing timing behavior. Optical timing uses pure clock synchronization; output-latency compensation and audio nudges belong only in the audio engine.

## 10. Contract and implementation guardrails

- Zod wire schemas, inferred TS types, generated JSON Schema, and golden fixtures move together. Python validates against the generated schema. Breakages require an explicit version/migration decision with consumers.
- Include session/epoch/revision identity on state and scheduled operations. Receipt time never becomes the scheduled execution time. Unit suffixes such as `Ms`/`Seconds` are mandatory at clock boundaries.
- Do not invent a second clock estimator in the client, dashboard, audio engine, or OTC renderer. Use `packages/sync/`; inject a fake clock in tests.
- Keep identity separate from credentials. Device ID 0 is valid. IDs do not wrap/recycle within a session, and a stale recording or event cannot mutate a newer run.
- Track/channel/show/assignment are different concepts. The server owns routing and transport; the dashboard and phones render or execute confirmed state.
- Keep CPU-heavy video work out of the control process. Stream uploads and decoded frames; do not retain all uncompressed 4K frames in memory.
- Reject ambiguous optical identities/locations. Unknown is a valid result. A manual column and a synthetic demonstration point must be visibly distinguished from optical localization.
- Apply changes at common future times, invalidate superseded source nodes, and test reconnect/late delivery. Do not broadcast a plain "play now" and call it synchronization.
- Honor browser user gestures, AudioContext state, and media readiness. A socket connection or a successful fetch does not prove a phone can emit sound.
- Use the manual-column fallback and the scoped timeline already planned. Avoid adding a generic event platform, full DAW, ML pipeline, broker cluster, or native application without a demonstrated requirement.

## 11. Verification and reporting

Run the focused gate for your branch and the relevant contract checks. Tests should verify behavior or reproduce failures, not mirror implementation details. For a simple documentation/style change, targeted inspection is sufficient; do not invent a test suite solely to test a reversible edit.

Foundation commands are executable and documented in the root README. Team 1 runs `bun run gate:sync`, Team 2 `bun run gate:client`, Team 3 `bun run gate:otc` after `bun run setup:python`, and Team 4 `bun run gate:admin`. Audio/selection package tests are included automatically when added; coordinate any other new test directory with the captain so it is not left unexecuted. Real video processing, load tests, and concert end-to-end tests are pending implementations, not green scaffold checks.

When fixing a failure, reproduce it with the smallest meaningful fixture, make the fix, rerun the affected checks, and complete the required gate. Do not rerun unrelated expensive tests without a reason. Shared protocol changes justify all consumer gates.

Do not weaken assertions, suppress failures, switch to permissive decoding, hard-code fixture IDs, or silently loosen acceptance targets to obtain green tests. Report unrelated/pre-existing failures separately and preserve their evidence. State exactly what was tested and what remains unverified.

Keep these evidence categories separate:

- Deterministic unit/contract tests.
- Synthetic video and simulated WebSocket load.
- Real-browser interaction tests.
- Physical phone/camera/acoustic and venue-network tests.

A 1,500-socket simulator does not prove 1,500 real phones can preload, flash, decode, or sound synchronized in the auditorium. A clock-quality estimate does not measure audio onset. A generated video does not establish robustness to real exposure, rolling shutter, or hand motion.

Every handoff/final report includes changed behavior and files, checks actually run and their results, remaining risks/blockers, and the exact next consumer action. Do not mark a stage verified while its required physical test is outstanding; use `ready for integration` with the missing evidence named.

## 12. Starting brief for each agent team

Use the applicable row as the team's initial assignment; subordinate agent tasks must specify an even smaller owned scope and acceptance check.

| Team | Starting assignment | First independent proof |
| --- | --- | --- |
| Sync/control | Extract the inspected BeatSync probe/estimator into `packages/sync/`; build the authoritative registry, protocol, routing, and worker adapter in `backend/` | Fake-clock tests plus simulated phones receive a future cue and correct per-device assignment |
| Audio/client | Extract the AudioContext/buffer/scheduling behavior into `packages/audio/`; build join/unlock/readiness and the shared-codebook screen renderer | Mock server drives a real phone through join, calibration, playback, and channel switch |
| OTC | Implement the frozen packet decoder, video timestamp handling, moving-screen tracks, conservative identity acceptance, and camera mapping | CLI decodes a known recording into schema-valid IDs/locations with rejected cases explained |
| Admin | Build calibration upload/review, audience selection, assignments, and the shared multitrack console behind the frozen adapter | Deterministic mock walkthrough from uploads to map to selection to scheduled four-channel playback |

Before calling the work complete, update your stage/status/handoff and make the next teammate's required action reproducible from the repository alone.
