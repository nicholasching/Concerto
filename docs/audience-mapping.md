# Map devices into automatic audience sections

The operator console supports one, two or three camera recordings. New uploads automatically map decoded phones using the camera frame and the demo's stage-facing orientation. These are approximate screen positions; optional seating corners improve perspective placement. Old results remain unchanged until processed again.

## Calibrate the camera views

1. Record the calibration pattern with fixed cameras and upload the original clips. Include only the recordings you actually have, with one distinct recording per view. Set each camera's primary audience column.
2. Select **Process uploaded recordings** for automatic positions. The default camera direction is **From the stage toward the audience**. In **Camera layout**, rotate the picture upright if necessary or change the direction for a rear-facing camera. No corner selection is required.
3. For optional perspective correction, open **Camera layout**. In the demo's stage-facing picture, audience-left is on the **right of the image**. Click known seating corners in order: audience **front-left, front-right, back-right, back-left**. Enclose the seats in that camera's primary column. The local video or processed preview supplies the image.
4. **Use automatic frame layout** clears manual corners and restores approximate screen positions. The mode is recorded as `frame-layout`, distinct from manual anchors. A raised phone can appear farther back; this does not measure seat depth.
5. Select **Process uploaded recordings**. This saves your visible geometry edits before processing. Review the device IDs, positions, orientation and unresolved devices, then check the review box and **Commit map and assign sections automatically** while playback is stopped. Changed geometry requires a new processing result before commit.

Each camera maps its primary column into the corresponding third of the audience map. Missing recordings leave the other views unavailable; they do not block the views you have. A single camera assigned to center therefore places its devices in the center third. The four audience sections are calculated from device order independently of these three camera columns.

The map has the stage at the top, audience-left at the left, and the back of the audience at the bottom. Four-corner calibration corrects the perspective of the chosen seating surface. It cannot determine seat depth from arbitrary phone height: a raised phone can appear farther back. Keep cameras fixed, hold phones at a consistent height, and check known front/back and left/right seats before the performance. The full-frame preset is appropriate for approximate grouping, not a claim of measured seat accuracy.

## Automatic sections and music presets

Set each section's music in **Performance → Prepare show and stems → Audience section presets**. Left, Center left, Center right and Right can each play Melody, Vocals, Percussion or Silent. Several sections can use the same lane. Upload the desired tracks to their lanes and save the show while stopped; saving also updates already assigned phones.

Committing calibration automatically sorts all localized phones from audience-left to audience-right and divides them into four groups of equal size. When the total is not divisible by four, remainder phones go left-to-right, so group sizes differ by at most one. Tied horizontal coordinates use depth, then device ID, for stable membership. Recalibration recomputes the groups from the new distribution.

Step **02 Sections** displays each group's count, music and map colors. The three boundaries follow the device distribution, not equal physical widths. There is no manual selection or assignment step. The reviewed calibration map and saved presets determine the routing.

Phones without accepted coordinates do not enter the automatic count. After calibration they can choose one of the four sections on their own screen; these fallback memberships appear separately and keep null coordinates. Their music follows the same presets, normally within two seconds, including during playback after readiness checks.

New OTC v2 runs jointly decode the repeated protected identity at 250 ms per symbol. Missing or unusable pilots can use measured preamble colors; a partially erased preamble needs sufficient matching evidence with no contradictory bits. V2 has no optical run tag: upload the correct clip. Legacy v1 recordings retain their exact run-tag checks. Participant membership, ambiguous identities and independent screen collisions remain checked. An unreadable repeat, size change, or brief fragment of the same screen is a review warning rather than a veto. Conflicting codes, duplicate IDs/reflections and real crossings remain unresolved. Review warnings and the annotated image before committing.

## Verification

On 2026-09-20, an isolated browser check verified eight synthetic localized phones split 2/2/2/2 despite uneven spacing, plus one explicit fallback phone. Saving changed presets updated those groups without another calibration. Unit/API tests also cover ties, small crowds, 1,500 devices, partial recalibration and checkpoint recovery. These are software checks; actual venue placement and phone audio still require a physical rehearsal. The earlier four-device physical sample remains historical evidence for camera geometry, not a physical verification of this new automatic workflow.
