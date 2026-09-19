# sync-control checkpoint

Status: not started (foundation available).
Owner: Team 1 human lead, to be named.
Branch: feat/sync-control. Base: foundation-v1; record resolved SHA in first journal.

- Owned files: backend/, packages/sync/, tools/load/
- Implemented foundation: Health/501 backend, epochNow/clock interfaces, fixtures and mock tests.
- Assigned feature work: Production NTP lifecycle, identity/control state, uploads/jobs and socket load harness.
- Independent command: `bun run dev:sync-demo`.
- Gate: `bun run gate:sync`.
- Foundation evidence: [verification](../../evidence/foundation/verification.md). No feature/hardware gate has passed yet.
- Next action: Extract the per-session coded probe estimator from the recorded BeatSync source paths and port its focused tests.
- Dependencies: Teams 2 and 4 consume clock/control; Team 3 supplies the worker boundary. Frozen fixtures permit work now.

Update this checkpoint at each handoff. Append experiment history in agent-owned journals.
