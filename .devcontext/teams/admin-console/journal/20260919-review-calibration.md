# Independent calibration review

Status: in progress. Reviewer scope: read-only calibration upload/job/review/commit UI and its frozen consumer boundary. Baseline `foundation-v1`: `ab59c27105627977ee52dc2bcd4276b4532b9e2a`; reviewed `feat/admin-console` HEAD: `30054a6b8cf310a943dafa8954e24162f57618ba`.

## Assumptions and plan

- Parent reviewer owns the focused gate and overall review; this reviewer changes only this journal.
- Required root/team instructions, architecture/glossary, stage 04, current status/handoff, foundation ADR, and OTC schema notes were read. Treat removal of the runtime mock as an accepted prior user direction recorded by this branch; do not request its restoration as production behavior.
- Distinguish missing producer services (Teams 1/3) from admin consumer omissions that remain even with correct services.
- Trace CalibrationPanel and Review through adapter to frozen contracts and masterplan acceptance. Check concrete state transitions for retry and tab navigation. Record exact source ranges; no dependency installations or application changes.

## Initial findings from inspection

- The only run creation uses a hardcoded `0..29` participant set. It neither receives nor examines live device eligibility.
- `armCalibration` exists only on the adapter; there is no caller, preparation/readiness state, or arm/countdown UI. Creating a plan cannot produce the scheduled calibration run required before filming/upload processing.
- Job polling retains only stage/progress/message. Commit becomes available on `complete` without candidate result review; Review reads the prior committed snapshot map.
- `canProcess` requires `!jobId`, while terminal failed/cancelled jobs retain `jobId`; no retry/cancel/reset control exists.
- Camera slots have only column/file inputs. No anchors, rotation, exclusion masks, or result diagnostic/observation review is wired.

Verification category: static source/contract review only so far. Physical camera/phone checks are not claimed.

## Completed review / handoff

Status: review complete; calibration consumer is not ready for complete workflow integration.

Actionable findings (all present on the reviewed HEAD):

1. **P1: Use eligible live participants instead of fixture IDs.** `CalibrationPanel.tsx:27-29` always submits exactly IDs 0 through 29. A smaller real session sends nonexistent participants; a larger one silently excludes all IDs >=30. Masterplan 5.3 requires joined, foreground, opted-in, synchronized participants. Pass authoritative eligibility/selection into the panel and test non-contiguous and >30-device sessions.
2. **P1: Complete the preparation/arm transition.** `CalibrationPanel.tsx:29-30` treats create as a started run and exposes uploads. `rg -n armCalibration admin-frontend/src` finds only the unused adapter definition (`adapter.ts:102-104`). Contracts separate `CalibrationPlan` from `CalibrationRun.startServerMs`, and masterplan 5.3 requires readiness then a future arm. Even a conforming backend cannot make the UI trigger the required `/arm` command. Add prepared/readiness state, exclusions, explicit arm and countdown.
3. **P1: Review the candidate result before committing it.** `CalibrationPanel.tsx:65-67,85-86,125` discards everything except progress and enables Commit on complete. `page.tsx:76` reviews only `snapshot.audienceMap`, which is the prior committed map. There is no `OtcResult` consumer, camera diagnostics/observations or candidate map view. A backend conforming to the requirement to retain the old map until review therefore gives operators no way to inspect the proposed result. Fetch/validate/render the candidate result, its evidence/rejection diagnostics, then commit that reviewed job.
4. **P2: Preserve calibration state across tab navigation.** `page.tsx:67-69` conditionally mounts the panel, but run ID, upload IDs and job ID live only in panel state (`CalibrationPanel.tsx:13-21`). Start a run and upload a file, switch to Review/Session, then return: the panel starts blank and cannot continue the prior job. Store the workflow at page/session level or restore it from authoritative state; scope/cancel polling to its lifetime.
5. **P2: Allow terminal and transient job failures to recover.** `CalibrationPanel.tsx:67-68` stops polling on failed/cancelled or a network error; `:85` forbids any further processing while `jobId` is set, and only successful commit clears it (`:79`). A failed job or one transient polling failure leaves the run stuck with no retry/resume/reset action. Preserve successful uploads while allowing retry/resume according to the server's semantics.

Additional required scope still absent: capture metadata UI/payload for rotation, ordered anchors and exclusion ROIs (`CalibrationPanel.tsx:6,99-109`; `adapter.ts:106-117`). These are Team 4 controls, not Team 3 decoder internals, and are necessary for masterplan 5.5's mandatory manual geometry fallback. Camera IDs are also fixed labels rather than operator inputs.

Commands/checks actually run: `git status --short` (initially clean), `git rev-parse HEAD`, `git rev-parse foundation-v1`, `git diff foundation-v1..HEAD --stat`, numbered source reads, and `rg` call-site/type searches. Parent reviewer owns gate execution; this journal claims no separate gate or real-browser/physical verification. No application/source edits, installs, or commits were made.

Known producer dependencies: Team 1 must supply authoritative calibration create/readiness/arm/upload/job/commit APIs; Team 3 supplies decoding and candidate diagnostics. Those dependencies do not resolve the consumer defects above. The recorded removal of the runtime fake harness is treated as intentional; successful/error/retry workflows still need deterministic consumer tests with injected boundary responses. Next action: Team 4 repairs these state transitions and adds focused success/retry/tab-navigation/candidate-review checks before repeating `bun run gate:admin` and integrated walkthrough.
