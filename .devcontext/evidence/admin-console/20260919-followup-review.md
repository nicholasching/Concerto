# Verification of admin remediation

**Verdict: partial remediation; still not ready for completed-feature integration.**

Reviewed commit: `909e42a6b608eac6683b420456b31e7ced8083c5` (`fix(admin): remediate command and selection review findings`). Prior review commit: `d5a01fa`. Worktree: `C:/Projects/HTN-worktrees/admin-console`. Date: 2026-09-19.

The worktree was clean and fast-forwarded to the latest fetched remote. The branch's own updated status accurately says **in progress**; its remediation journal explicitly leaves calibration and shared-clock work unfinished. No implementation or shared contract changes were made during this verification.

## Blocking findings after the fixes

### F1 / R2 — P1: Cancelled commands are still reported as effective

At `admin-frontend/src/lib/adapter.ts:81`, any previously observed scheduled action becomes `effective` when it disappears from `pendingActions`. Disappearance also occurs when another command supersedes it or panic cancels it. The code ignores `supersedesCommandId`, the original effective time and actual assignment/transport state.

Two deterministic cases reproduce the failure: schedule an assignment 60 seconds ahead, observe it as scheduled, then replace it with a superseding action or remove it after panic. The assignment never applies, but the adapter reports `effective` with 60 seconds still remaining. The old network-failure/unrelated-revision case is fixed, but R2 is not closed.

Use explicit command/domain cancellation information and authoritative effective state. Add supersession, panic, epoch and missed-poll cases to gate tests. Do not infer execution merely from absence.

### F2 / R9 — P2: Mixed-channel Undo fails partway and loses its retry state

`admin-frontend/src/components/AssignPanel.tsx:47-48` now iterates separate prior channel groups. However, it sends those groups sequentially through `assign()`, whose refresh at line 37 is not awaited; the adapter's command context remains on the last snapshot revision (`adapter.ts:107`).

A handler-level reproduction uses the real adapter with a revision-validating HTTP double and delayed snapshot replies. Original assignment is accepted at expected revision 100. Undo sends its first group at revision 101 and succeeds, advancing server revision to 102. Its second group still sends expected revision 101 and receives 409. `assign()` swallows the error, then `doUndo()` clears history and disables Undo anyway. Only the first restoration request is accepted.

Sequence restoration against validated authoritative revisions, use a common future execution time, and retain failed groups for retry. Avoid clearing history unless the full restore is accepted. The probe does not claim a real server was run; revision checks are frozen producer semantics.

### F3 / R10 — P2: A late mutation reply revives an obsolete epoch command

GET response ordering is improved, but `admin-frontend/src/lib/adapter.ts:97` unconditionally sets a command to `accepted` after its response arrives. Reproduction: send an assignment in old-epoch, receive a new-epoch snapshot (command becomes obsolete), then resolve the old POST with a valid old-epoch `CommandAccepted`. The command becomes accepted again. Matching schema shape does not verify response identity against the current session/epoch or preserve terminal state.

Validate response command/session/epoch and retain obsolete/cancelled states across late replies. Add a POST-in-flight restart test alongside GET ordering tests.

### R6-R8 / R11-R13 — Original gaps remain open

- There is still no caller of `armCalibration`, preparation/readiness/capture countdown, or candidate `OtcResult` review before Commit.
- `adapter.ts:119,136` still assumes run/job resource fields absent from frozen `CommandAccepted`; these methods now explicitly bypass acceptance validation. A valid contract response still gives undefined run/job IDs. Team 1/captain must agree the resource/result boundary with Team 4.
- `clock.ts` and `useSnapshot.ts` are unchanged. The response-latency probe still moves a playing playhead backward 400ms. Future commands now have a nominal three-second lead, but still use this interim clock with no shared clock-quality/preparation gate.
- Calibration remains conditionally mounted with run/upload/job state stored locally. Leaving the tab loses the workflow. Failed/cancelled jobs or polling failures still have no retry/resume path.

The new journal groups tab persistence and retry under the producer blocker. Preserving existing local state across tab changes, cleaning up polling, and retrying a failed progress GET can be implemented against the current state/`JobProgress` boundary; those portions do not require inventing a new response schema. Cross-reload restoration and actual resource retrieval still need the producer agreement.

## Previous finding disposition

| Finding | Result at 909e42a | Evidence / limitation |
| --- | --- | --- |
| R1: past timestamps | Partially addressed | Actual Play/mix handlers schedule at least 3000ms ahead of the interim clock. Shared clock and preparation/readiness remain missing. |
| R2: false confirmation | Partially addressed | Failed requests stay error; future actions show scheduled. Superseded/panicked actions still falsely become effective (F1). |
| R3: lost selection revision | Original defect fixed | After a selection on map 1 and snapshot replacement by map 2, actual Assign handler sends mapRevision 1. This permits authoritative stale-map rejection. |
| R4: canvas mismatch | Fixed | Actual drag handlers select the visible device-0 dot at both full and half CSS scale. |
| R5: IDs 0-29 | Original defect fixed | Actual Calibration handler sends eligible live IDs 7 and 42, excludes disconnected ID 100. Full optical eligibility/readiness remains producer integration work. |
| R6: no arm transition | Open | Adapter definition still has no caller. |
| R7: no candidate review | Open | No `OtcResult` consumer; Commit still enabled solely on job completion. |
| R8: response contract mismatch | Open | Valid `CommandAccepted` still yields undefined runId/jobId; no approved contract change. |
| R9: Undo | Partially addressed | Per-device channel groups retained; multi-group restore has revision race and discards failures (F2). |
| R10: epoch/order safety | Partially addressed | Original out-of-order GET scenario passes; old POST response revives obsolete command (F3). |
| R11: independent receipt-time clock | Open | Unchanged helper; 400ms backward jump reproduced. |
| R12: tab state loss | Open | Conditional mount and panel-local run/upload/job state unchanged. |
| R13: job recovery | Open | Failed/cancelled/poll-error paths still retain jobId with Process disabled. |
| R14: hidden disconnect | Banner defect fixed; recovery incomplete | Page renders an alert with a retained snapshot. Mutation controls remain enabled against stale state. |

The other masterplan acceptance gaps in [the original review](20260919-review.md) remain: geometry/rotation/exclusion inputs and camera evidence, manual/column fallback and unresolved-device list, lasso, real QR/join/readiness/channel counts, persistent panic, scoped stopped-show editing/waveforms/cues/master gain/arbitrary seek, and successful browser/operator workflow evidence. Stage 04/handoff still contain stale foundation/deleted-file claims; status is now more candid.

## Verification actually performed

- `bun run gate:admin` from this worktree root using Bun 1.3.14: **PASS**. Contract/fixture drift and boundary checks, root typecheck/lint, **14 contract tests + 16 admin/selection tests**, and production Next build all passed.
- `bun .devcontext/evidence/admin-console/review-followup-adapter.ts`: exit 0. Seven recorded cases establish corrected network failure/GET ordering subcases and reproduce cancellation, old POST, response identity and clock defects. Results: [adapter results](review-followup-adapter-results.json).
- `bun .devcontext/evidence/admin-console/review-followup-ui.ts`: exit 0. Six recorded groups verify actual component handlers for coordinate scaling, captured revision, scheduling lead, live participant IDs, disconnect banner and partial Undo failure. Results: [UI results](review-followup-ui-results.json).
- Probe assertions deliberately describe the observed behavior. Exit 0 is successful verification of that evidence, not acceptance of the reproduced defects. The original review probes were preserved as historical evidence; their old defect assertions are not treated as acceptance tests for fixed behavior.
- `git diff --exit-code`: no tracked application edits. Only new reviewer-owned journal/report/probes/results were added.
- Fetched `origin/feat/sync-control` still resolves to `foundation-v1`; no real feature-server/shared-clock integration was available. No browser, physical phone/camera/acoustic, or venue-network verification is claimed.

## Next action

Team 4 should close F1-F3, complete the independent UI persistence/recovery work, and add those regression cases to the admin gate. Team 1/captain and Team 4 must settle the resource/result/session/auth and shared-clock interfaces before completing calibration and a real operator walkthrough. Retain `in progress`; do not mark all review findings addressed or approve integration yet.

This follow-up verification adds review evidence only; no implementation fix or integration merge was performed. The user subsequently authorized committing and pushing this second review and its reproduction evidence to `feat/admin-console` for the responsible teammate to fix.
