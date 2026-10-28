# Rename the three musical lanes

Date: 2026-09-20. Owner: integration captain. Status: accepted by explicit user request. Affected owners: contracts/fixtures, sync/control and admin.

Supersedes the labels in [the fourth-track decision](20260920-four-musical-tracks.md): Vocals becomes Percussion, Percussion becomes Vocals Left, and Percussion 2 becomes Vocals Right. The order is Melody, Percussion, Vocals Left, Vocals Right. Apply the mapping simultaneously so the new Percussion label is not renamed again.

This is a naming change. Channel IDs, clips, assets, mix settings, section presets and existing assignments retain their meaning. Unconfigured fallback routes keep their original lane IDs: Melody on the left, the former Vocals lane in the centers, and the former Percussion lane on the right. Recognize legacy shows as well as the new names; saved section presets remain authoritative. No protocol/schema change.

Verification and saved-show handoff: [journal](../teams/integration/journal/20260920-track-labels.md).
