# Admin remediation verification

Date: 2026-09-19. Reviewer: Codex. Status: verification complete; changes still required.

- User requested pulling and independently verifying the teammate's fixes.
- Clean worktree fast-forwarded from review commit `d5a01fa` to `909e42a` (`fix(admin): remediate command and selection review findings`).
- Original OTC checkout remains untouched. Review only; no application edits or integration merge planned.
- Read current rules/masterplan, context index, architecture/glossary, stage/status/handoff, remediation journal, prior review, frozen contracts and relevant decisions.
- Scope: re-evaluate R1-R14; distinguish confirmed fixes from partial fixes and admitted open gaps. Test actual components/adapter with deterministic boundary doubles; do not reintroduce runtime mock harness.
- Checks: root `bun run gate:admin`; updated review-only regression probes; source comparison against approved contracts. Producer sync/control remains `foundation-v1` after fetch, so no real producer integration claim.
- Initial result: 14 contract and 16 admin/selection tests pass; production build in progress. Remediation notes explicitly leave R6-R8/R11-R13 open.

## Experiments and handoff

- Full root `bun run gate:admin` passed: 14 contract + 16 admin/selection tests, typecheck/lint, boundaries/drift, production build.
- New review-only adapter probe verifies the original network-failure and older-GET cases are fixed, but reproduces false effectiveness after supersession/panic, revival of obsolete commands by late old-epoch POST responses, undefined calibration/job identities under the frozen response, and the unchanged 400ms clock jump.
- New component-handler probe verifies padded/full/half-scale selection, retained map revision, three-second nominal scheduling lead, live participant IDs and visible disconnect alert. Real adapter plus delayed/revision-validating HTTP double demonstrates second Undo group rejected at stale expectedRevision and history cleared despite failure.
- Probes ran successfully with recorded JSON outputs. They contain both fixed-behavior assertions and defect reproductions; their success is not a blanket product acceptance claim. Original historical probes/results remain unchanged.
- Static comparison confirms R6-R8/R11-R13 and other original masterplan gaps remain. Producer contracts constrain resource retrieval; local tab persistence and progress-GET retry are independently repairable.
- Report: `.devcontext/evidence/admin-console/20260919-followup-review.md` with R1-R14 disposition, remaining priorities and next owner actions.
- A source-search attempt used a literal Windows wildcard path and failed; retried successfully using `rg -g '*.tsx'` on the directories. No product/test failures were hidden.
- Verdict: fixes are partial; still not ready for completed-feature integration. No implementation changes, commit/push, browser/physical/live-server tests or integration merge in this verification. New review evidence remains local and uncommitted.

## Publication follow-up

- User explicitly authorized committing and pushing the second review and its reproduction evidence.
- Fetched `origin/feat/admin-console`; local and remote remain at reviewed commit `909e42a`, with no intervening implementation changes.
- Publication includes only the six reviewer-owned follow-up report/journal/probe/result files. Application code and the original OTC checkout remain untouched.
- Prior gate and probe results apply to the unchanged reviewed implementation; publication checks cover staged scope and whitespace.
