# Integration status

Status: verified for local software, 2026-09-19. Physical rehearsal not started.
Owner: integration captain / main / foundation-v1 plus all four development branches.

- Tasks 1/2 pulled in their worktrees and reviewed. Fix commits: sync a35ce11, client b71425a. OTC 17299a1 and admin 82cd86f merged; all four are ancestors of main through merge 5eb08ab.
- Real operator/participant clocks and authentication, show upload/editing/waveforms/cues, calibration prepare/arm/capture reports, camera geometry/upload/worker/review, map filtering/selection, channel assignment, transport/mix/panic and durable restart are integrated.
- Shared protocol additions are coordinated under [the accepted ADR](../../decisions/20260919-140000-integration-boundaries.md). Generated schemas/fixtures and consumers move together.
- Verification uses unit/contract gates, production HTTP startup, real HTTP/WS/worker E2E, desktop browser walkthrough, source isolation and 1500 socket load. See [verification](../../evidence/integration/verification.md) for exact evidence and limits.
- User explicitly deferred Railway until after local review. Physical phones, real camera visibility, acoustic timing, venue Wi-Fi, three rehearsals and a demo freeze are outstanding. No stage-ready or deployment claim.
- Preserved the admin worktree's pre-existing untracked journal. No remote push or history rewrite.

Next action: user local review, then follow [handoff](handoff.md) for the separate physical/deployment milestone. Local services are running with four test tones and stopped transport.
