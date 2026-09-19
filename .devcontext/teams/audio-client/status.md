# audio-client checkpoint

Status: in progress (slice 1 ready for integration; physical checks outstanding).
Owner: Team 2 human lead, to be named.
Branch: feat/audio-client. Base: foundation-v1 = ab59c27105627977ee52dc2bcd4276b4532b9e2a.

- Owned files: client-frontend/, packages/audio/, tools/client-demo/
- Implemented (slice 1, [subplan 01](plans/01-audio-context-preload-click.md)):
  - `packages/audio`: one-AudioContext host with gesture unlock, SHA-256/size-verified track loading, 64 MB decoded-byte budget, single server→audio time mapping, scheduled start that refuses late cues.
  - `client-frontend`: mock-only "Audio check" section driven by a labeled local fixture clock.
- Not yet: join/resume, snapshot-driven playback, channels, packet renderer, mobile lifecycle beyond unlock/interrupted resume.
- Independent command: `bun run dev:client-demo`.
- Gate: `bun run gate:client` passed 2026-09-19 on the slice 1 working tree (18 tests, build ok).
- Unverified: audible output (the desktop Chrome check confirmed decode and scheduling only), iOS Safari / Android Chrome, two-phone click (needs Team 1 estimator), acoustic onset.
- Next action: listen to the desktop tone check, then run it on one iOS and one Android phone over a reachable origin. Then start slice 2 (join/resume adapter). See the [journal](journal/20260919-022014-claude.md).
- Dependencies: Team 1 supplies the real `SynchronizedClock` and join API. The captain needs to review the `bun.lock` and `THIRD_PARTY_NOTICES.md` edits.

Update this checkpoint at each handoff. Append experiment history in agent-owned journals.
