# Melody, Vocals and Percussion

Date: 2026-09-19. Owner: integration captain, main working tree at a052e6816dbbbe144ba2301ccd5aec8e9dc08d22.

The user changed the show scope during the audio-budget fix: exactly three channels, in order Melody, Vocals, Percussion. The four development teams/branches are unchanged. Preserve unrelated OTC and earlier sync work.

Plan: share the default channel definitions between the editor, initial server placeholder and synthetic seed generator; update demo fixtures/consumers and current documentation. Keep generic routing/playback contracts intact. Verify gates and live operator/participant state.

Live migration: preserve existing Melody and Percussion IDs/assets; relabel Harmony as Vocals, retaining its four device assignments. Bass has zero assignments and will leave the show. Preserve uploaded files and a recovery copy of the original four-lane draft in ignored runtime/local/. The three surviving lanes retain their visible clip timing/gain. Show save uses the real revision/epoch guarded API while stopped; no playback is started.

## Results

- Shared `DEFAULT_SHOW_CHANNELS` defines Melody, Vocals and Percussion. The empty backend show, editor setup and fixture generator consume it; seed output and console copy now match. Generated show/admin/participant/server-message fixtures contain three channels; the unused fourth synthetic tone was removed. Generic channel schemas are unchanged.
- Existing playback crossfade and missing-asset tests now exercise the third fixture channel instead of the removed fourth. One initial sync-gate failure expected the old single-channel placeholder; its assertion now checks all three requested names explicitly.
- Final gates: sync 209 tests, client 121 tests, admin 21 tests; all passed with 14 contract checks each, schema/fixture drift, boundaries, typecheck, lint and builds. Logs are ignored `runtime/local/gate-three-channels-*.log` (sync final run ends `-sync-final.log`).
- `bun run test:e2e`: PASS. Four real WebSocket participants route across the three channels; real generated-video processing, map review, assignments, preparation, playback, exclusions, mix, panic and restart all pass. This is synthetic-video/recording-audio-double evidence, not a physical rehearsal. OTC source changes belonged to concurrent work and were not edited here.
- Live migration used the real guarded `/api/show` PUT at stopped transport. Revision 2 contains the preserved three lanes, six clips, six verified on-disk assets and a 283.4815-second timeline. All pre-existing device channel IDs stayed assigned as before; Harmony is now labeled Vocals, Bass had no assigned devices. Original source files, original saved-show backup and full four-lane draft backup remain under ignored runtime/local/.
- Operator browser visibly shows exactly Melody/Vocals/Percussion. The public audience browser verifies 6/6 assets, clock sync and audio unlocked at the new budget. The user subsequently started playback; no playback command was issued during this work and it was left running.

Status: complete for the requested software change. Phones with older pages should refresh before their next test to acquire the new loader limit. Uploaded full-song audio was preserved, not separated into instrument/vocal stems. Physical phone memory and acoustic performance remain rehearsal work.
