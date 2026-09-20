# Three musical channels

Date / author / team: 2026-09-19 / integration captain.
Status: superseded by [four musical tracks](20260920-four-musical-tracks.md), 2026-09-20. Originally accepted by explicit user request.
Affected teams: sync/control, audio/client, admin/console, captain fixtures.

## Decision

The current concert and new-show/demo defaults have exactly Melody, Vocals and Percussion, in that order. One shared channel preset drives the editor, server placeholder and generated show. Protocol v1 retains generic channel IDs and arrays; this does not change the four-team development arrangement.

For the existing local show, keep Melody/Percussion identities and convert Harmony to Vocals so its device routing survives. Remove the unused Bass lane from the saved show, preserving its uploaded bytes and the old draft backup outside Git. All existing lanes currently use the same uploaded song, so changing channel labels does not separate vocals/instruments automatically.

## Verification

Update generated fixtures and tests that referenced the removed fourth fixture channel without reducing readiness/scheduling coverage. Verify saving, three-lane display, routing labels and participant decoded readiness. Physical sound quality remains unverified.
