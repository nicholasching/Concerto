# Decoded audio budget increase

Date: 2026-09-19. Owner: integration captain. Baseline: main at a052e6816dbbbe144ba2301ccd5aec8e9dc08d22, with existing connectivity/clock changes and independent OTC work preserved.

## Request and evidence

The user's unsaved show displays 405.5 MiB decoded against a 64 MiB budget. The editor disables Save at 64 MiB; backend validation and participant DecodedBudget independently enforce the same hardcoded limit. Raising only the editor would still fail saving/loading.

The current stopped draft contains four original eight-second tones plus the same 275.48154166666666-second stereo song uploaded separately in each of four channels. DOM values were read before edits. Existing saved show and an equivalent recovery draft referencing the already uploaded assets are backed up under ignored runtime/local/show-before-budget-change.json and show-draft-budget-backup.json. The recovery draft reconstructs new clip IDs from visible editor values; original upload files are unchanged. Displayed size agrees with 48 kHz stereo decoding; all four song assets have the same SHA-256. No raw audio is committed.

## Plan and acceptance

- Use one shared 512 MiB decoded-byte limit in contracts, consumed by editor, backend and audio cache. Keep the existing audio export compatible. This follows the user's explicit budget-increase request and captain integration scope; no wire schema change.
- Reproduce acceptance of a roughly 405.5 MiB show in backend and participant tests, and retain rejection above 512 MiB.
- Run gates sync, client and admin from root, then verify the live Save workflow and decoded readiness. Preserve the unsaved draft through backend restart. Do not start playback.
- The decoded-buffer ceiling is not a physical-memory guarantee: decoding, encoded downloads and browser overhead require additional memory. Phone rehearsal remains necessary.

## Results and handoff

- Before the change, four focused regressions failed: a 405.47 MiB show/save and preload, plus exact 512 MiB acceptance in both budgets. Afterward all four pass, including rejection beyond the ceiling. Audio tests use buffer metadata doubles, not 400 MiB allocations.
- Initial gates passed: sync 209 tests, client 121, admin 21, each with 14 contract tests, drift/boundary/lint/type checks and its build. Focused audio/show run: 34 passed.
- Live editor hot refresh retained the original draft and showed 405.5 / 512 MiB with Save enabled. Stopping the Windows dev supervisor also stopped its children; the stack was restarted successfully. Browser refresh discarded unsaved React state, so the pre-recorded backup was used for the user's subsequent three-channel request. No uploaded audio was lost.
- The revised three-channel show was accepted by the real API as show revision 2, six clips/tracks, 304.1179 MiB estimated, with every device assignment preserved. See [channel migration](20260919-three-channels.md).
- A fresh real audience browser through https://htn.nicholasching.ca loaded and hash-verified all 6/6 tracks, unlocked audio and synchronized its clock. This verifies the larger default reaches the participant loader. It does not measure physical phone memory availability or acoustic timing.
- Existing phone tabs need refreshing to replace their old in-memory 64 MiB budget objects. The 512 MiB default is compiled into each app; no environment setting or schema regeneration is required.

Status: verified for local software and desktop browser loading. Reference tree, optical work, tunnel configuration and earlier sync changes are outside this patch. No new commit/push was requested for this follow-up.
