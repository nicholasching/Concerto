# Manual sections select an audio part

Date / owner: 2026-09-20, integration captain.
Status: accepted under the user's manual-section bug report and explicit default-mapping reply.
Affected teams: sync-control, audio-client, admin-console. Wire protocol v1 unchanged.

## Context

`participant.column` persisted a coarse location but left `assignment.channelId` null. Separately, the original Play recipient set permanently hid a playing transport from a late phone. Selecting a section therefore did not reliably produce audio even when the phone was synchronized and its assets were verified.

## Decision

The backend resolves manual left/center/right choices to Melody/Vocals/Percussion by channel **label**, preserving legacy IDs and reordered shows. A unique most common operator-assigned channel in the chosen column takes precedence; no votes or a tie uses the agreed default. If a custom show has neither a matching default nor a unique section assignment, keep the phone unassigned and show that it is waiting for the stage team.

Manually routed phones follow later operator section changes at a future shared time. They do not contribute votes themselves. Explicit operator assignment or clear of a phone ends its automatic following. Selecting a new manual section re-enables it. This is a separate per-device automatic assignment, not a mutation of the operator's explicit selection. Column routing uses the committed map's column, not the Assign canvas's temporary divider positions. Use the column buttons for an explicit whole-column override.

A participant choice schedules routing two seconds ahead; repeated choices/join waves do not keep postponing an existing assignment. A follower of an already pending section change waits at least until that change. Checkpoint v3 gains an optional/default-empty `manualRoutingDeviceIds` field (no public credential or new wire field). Restore repairs historical manual locations that never received an assignment, while preserving explicit clears. Restart still stops playback.

Only a manually located, assigned, connected, foreground phone with a usable clock, unlocked sound and verified channel assets may be added to an already playing transport's recipient set. Existing client checks additionally require warmed output and fresh clock samples before scheduling a future rendezvous at the shared playhead. Manual choices cannot start a stopped/paused show or override panic. Other excluded phones retain their previous admission policy.

Locations remain `manual-column`, coarse, and null-coordinate. No optical evidence or seat precision is invented.

## Verification

See the [journal](../teams/integration/journal/20260920-manual-section-routing.md) for the failing regressions, focused gates, real HTTP/WebSocket integration, audio-scheduler evidence and physical-test limits.
