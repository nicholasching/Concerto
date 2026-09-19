# Integration status

Status: verified for local software, 2026-09-19. Physical rehearsal not started.
Owner: integration captain / main / foundation-v1 plus all four development branches.

- Tasks 1/2 pulled in their worktrees and reviewed. Fix commits: sync a35ce11, client b71425a. OTC 17299a1 and admin 82cd86f merged; all four are ancestors of main through merge 5eb08ab.
- Real operator/participant clocks and authentication, show upload/editing/waveforms/cues, calibration prepare/arm/capture reports, camera geometry/upload/worker/review, map filtering/selection, channel assignment, transport/mix/panic and durable restart are integrated.
- Shared protocol additions are coordinated under [the accepted ADR](../../decisions/20260919-140000-integration-boundaries.md). Generated schemas/fixtures and consumers move together.
- Verification uses unit/contract gates, production HTTP startup, real HTTP/WS/worker E2E, desktop browser walkthrough, source isolation and 1500 socket load. See [verification](../../evidence/integration/verification.md) for exact evidence and limits.
- User explicitly deferred Railway until after local review. Physical phones, real camera visibility, acoustic timing, venue Wi-Fi, three rehearsals and a demo freeze are outstanding. No stage-ready or deployment claim.
- Preserved the admin worktree's pre-existing untracked journal. No remote push or history rewrite.
- Cloudflare follow-up: one audience proxy origin, saved public QR links and Node-based Next startup are verified with unit/build gates, real local/production proxy checks and a live Quick Tunnel. Public browser reached Connected, Clock synced, Audio unlocked and 4/4 verified assets. [Evidence and limits](journal/20260919-cloudflare-testing.md).
- Physical-camera follow-up: fixed expired fragment accumulation that crashed the first original 1080p clip, and exposed worker errors in the console. The real retry completed in 53.5 s but recovered zero IDs; its candidate is uncommitted. Optical segmentation/association remains an observed physical limitation. [Reproduction and checks](journal/20260919-camera-worker-failure.md).

Next action: scan the saved public QR from physical phones, then follow [handoff](handoff.md) for the separate physical/deployment milestone. Local services are running with four test tones and stopped transport. Quick Tunnel URLs are temporary; use the setup guide to create/save a new URL after restarting the tunnel.
