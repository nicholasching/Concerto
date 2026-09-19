# Foundation implementation session

Status: verified software foundation; handing off to feature teams. Owner: repository scaffolding task. Starting baseline: main at f43be8c; delivered baseline: foundation-v1.

## Goal and assumptions

Prepare the repository for four independent agent teams: runnable application shells, frozen shared schemas and fixtures, meaningful branch gates, ownership/context files, and an accurate distribution-ready master plan. Feature implementation and hardware validation remain the teams' work.

The current user request authorizes the shared scaffold and plan updates. The existing uncommitted planning files were produced by this same task and will be preserved and finalized. BeatSync source remains reference-only. No team agents are being launched during preparation.

## Plan and verification

1. Establish pinned runtimes/workspaces and the smallest shared wire contracts -> verify installation, generated schema consistency, and codebook fixtures.
2. Create backend/client/admin/OTC shells and independent harnesses -> verify each focused gate and start/HTTP/CLI smoke checks.
3. Add team briefs, handoffs, CI, source provenance and onboarding -> verify commands/paths and a build context excluding BeatSync source.
4. Commit a foundation baseline, tag it, and create the four local feature branches -> verify all refs resolve to the same tested commit.

## Initial evidence

- Current source-control changes are planning documents only; main tracks origin/main at f43be8c.
- Node 22.14.0 and Python 3.13.15 are available; Bun/FFmpeg are not on PATH.
- Reference package.json pins Bun 1.3.8 while mise.toml pins 1.3.14. Foundation will pin one verified version without editing the reference.
- Full feature/load/audio/camera gates are not runnable yet. Foundation gates will be labeled and will assert real contracts/shell behavior, without pretending mocks implement those features.

## Next action

The original setup plan below has been completed. Next owner action: publish the local baseline when distributing it, select team branches/worktrees, and execute the four stage briefs.

## Scaffold checkpoint

- Installed task-local Bun 1.3.14 from its official versioned binary and resolved the pinned workspace dependencies. Reference source remains untouched.
- Added shared Zod models/messages, schema/codebook generators, original synthetic PCM tones, fixture manifests/results, typed package seams, backend health shell, frontend shells, and an explicit loopback-only mock server.
- First verification caught undeclared root dependencies under Bun's isolated linker, TypeScript 6 CSS side-effect declarations, and a discriminated-union narrowing issue in the crowd generator. Fixed the declared dependencies/types/control flow instead of weakening checks.
- The JSON observations are explicitly synthetic. Actual MP4 generation/decoding and feature control routes remain team work; unimplemented backend routes return 501.

## Final verification and handoff

- The first full build exposed Next's missing Node type dependency and attempted npm auto-install. Pinned the dependency in the Bun root, then passed all builds/tests.
- Full foundation gate passed: 23 Bun tests (6,194 assertions), 10 Python tests, typecheck/lint/Ruff, schema/fixture consistency, backend bundle and both Next production builds.
- Fresh source-free installation/build passed. Its first run revealed parent tracing-root inference in the nested temporary copy; explicitly scoped both frontend tracing roots and reran the isolated gate successfully.
- Verified built HTTP startup, all three independent development commands, combined real shells, manifest validation and explicit synthetic replay. Development servers were stopped after checks.
- Added four stage briefs with copyable agent assignments, four status/handoff/journal areas, scoped ownership instructions, shared schema/provenance notes, CI matrix and onboarding. Updated masterplan/rules/AGENTS to distinguish delivered scaffolding from pending features.
- Feature tests, reference two-phone timing characterization, camera footage/toolchain, full browser workflow, simulated socket load and physical venue/audio tests remain team milestones. No event-readiness claim is made.
- Exact commands/results/limits are in `.devcontext/evidence/foundation/verification.md`. The foundation commit/tag and four local feature refs form one common baseline; publishing is a separate captain step.
