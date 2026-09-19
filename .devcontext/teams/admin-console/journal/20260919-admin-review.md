# Independent admin-console review

Date: 2026-09-19. Reviewer: Codex. Status: review complete; changes requested.

## Scope and baseline

- Review requested by the user; no implementation fixes or merge requested.
- Worktree: `C:/Projects/HTN-worktrees/admin-console`, branch `feat/admin-console`.
- Reviewed HEAD: `30054a6`; base `foundation-v1` = `ab59c27105627977ee52dc2bcd4276b4532b9e2a`.
- Original checkout remains on `feat/otc-localization`, unchanged.
- Fetched remote refs. Sync/control remains at foundation, so integration compatibility is assessed against frozen executable contracts; a real server end-to-end check is unavailable.
- Read rules, master plan, context index/architecture/glossary/schema notes, admin stage/status/handoff, foundation ADR, and directory ownership instructions.

## Plan and assumptions

1. Independently inspect adapter/contracts, calibration, selection, assignment and performance UI against Stage 04 and masterplan sections 4, 7 and 8.
2. Run frozen install and `bun run gate:admin` from this worktree root; reproduce uncovered behavioral failures with small deterministic review probes.
3. Record actionable findings, acceptance gaps, physical-test limits and precise integration handoff. Do not equate green scaffold tests with feature completion.

Only reviewer-owned journals/evidence may be added. Preserve production source and existing handoffs. Review-only probes do not restore the removed runtime mock harness.

## Initial observations

- Branch modifies admin/selection/demo files and captain-owned `bun.lock` and `scripts/dev.ts`; handoff explicitly requests captain review.
- Branch removed its fake-input harness per a documented user direction. Review honors this; independent checks still need to exercise success and failure semantics through controlled test responses.
- Bun is absent from PATH; existing repository-local Bun 1.3.14 will be used without global installation.

## Verification and findings

- Frozen install succeeded under Bun 1.3.14; no lockfile edits.
- `bun run gate:admin` PASS: schema/fixture checks, boundaries, typecheck/lint, 14 contract tests, 13 admin/selection tests, production Next build.
- Independent adapter reviewer reproduced false command confirmation, prematurely confirmed future actions, epoch rollback on response reordering, incompatible calibration/job response assumptions and clock latency drift. Evidence probe and journal are adjacent; root reviewer reran them successfully.
- Independent calibration reviewer found hardcoded participants, absent arm step/candidate review, tab-state loss and missing job recovery/geometry inputs. Static findings are recorded in `20260919-review-calibration.md`.
- Root UI hook probe reproduced canvas hit-test mismatch, lost selection revision, mixed-assignment Undo corruption and zero-lead transport/mix scheduling. First probe attempt failed because replacing React hooks also removed JSX runtime internals; the review-only harness was corrected to use plain JSX objects, then all four defect assertions succeeded. Application code was never edited.
- Pairwise `git merge-tree --write-tree` with remote audio `c03cb5b` and local OTC `f962895` reported no textual conflicts. No branch merge occurred; these checks do not establish runtime compatibility.
- Final report: `.devcontext/evidence/admin-console/20260919-review.md`, with priorities, evidence, masterplan coverage and exact handoff.
- Verdict: partial masterplan alignment, not ready for completed-feature integration. Team 4 must address the findings; Team 1/captain owns response/session/auth/clock agreements. Physical/browser/live-server tests remain unverified.
- Source and original checkout preserved. Reviewer documents/probes/results remain uncommitted in this worktree; no commits/pushes or merges.

## Publication follow-up

- User explicitly requested committing and pushing the review and discovered gaps for the responsible teammate to fix.
- Rechecked `feat/admin-console` HEAD and fetched its remote: both remain at reviewed commit `30054a6`; no intervening implementation changes.
- Publish only the eight reviewer-owned documents/probes/result files. Existing application source, team handoffs and the original OTC checkout remain untouched.
- Prior gate and reproduction results apply to the unchanged reviewed implementation. Pre-publication verification is limited to artifact inspection and staged whitespace/scope checks; no redundant application gate is needed for these documentation/evidence additions.
