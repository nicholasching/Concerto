# Map devices and choose audience groups

The operator console supports one, two or three camera recordings. Optical decoding identifies each phone; camera geometry places those IDs on the audience map. Without geometry, a decoded phone has only a column and is listed below the map.

## Calibrate the camera views

1. Record the calibration pattern with fixed cameras and upload the original clips. Include only the recordings you actually have, with one distinct recording per view. Set each camera's primary audience column.
2. Open **Set seat coordinates — camera orientation and seating corners**. Rotate the picture upright first. You can use the original video or the processed camera preview; after a reload, the saved geometry and processed preview remain available during the run.
3. For the demo's cameras facing **from the stage toward the audience**, audience-left is on the **right of the image**. Click the seating area's corners in this order: audience **front-left, front-right, back-right, back-left**. The front edge is nearest the stage. Enclose all the seats in that camera's primary column. Use known corners of the seating area, not four arbitrary phones.
4. For a quick test, choose **Camera faces: From the stage toward the audience**, then **Use full frame for approximate layout**. This maps recorded screen positions and mirrors the stage-facing picture. It does not measure seat locations.
5. Select **Process uploaded recordings**. This saves your visible geometry edits before processing. Review the device IDs, positions, orientation and unresolved devices, then check the review box and **Commit reviewed map**. Changed geometry requires a new processing result before commit.

Each camera maps its primary column into the corresponding third of the audience map. Missing recordings leave the other views unavailable; they do not block the views you have. A single camera assigned to center therefore places its devices in the center third. Region dividers can still split those devices into independent groups.

The map has the stage at the top, audience-left at the left, and the back of the audience at the bottom. Four-corner calibration corrects the perspective of the chosen seating surface. It cannot determine seat depth from arbitrary phone height: a raised phone can appear farther back. Keep cameras fixed, hold phones at a consistent height, and check known front/back and left/right seats before the performance. The full-frame preset is appropriate for approximate grouping, not a claim of measured seat accuracy.

## Select and assign groups

Open **Assign** after committing the map:

- **Rectangle:** click a labeled device or drag a box around several devices.
- **Lasso:** draw around the devices you want to include.
- **Left / center / right dividers:** drag the two vertical lines, then choose **Select left region**, **Select center region**, or **Select right region**. A device on a boundary belongs to exactly one region. Dividers can sit anywhere across the map, including inside a single camera's column.

Check the highlighted devices and selected count. Choose **Melody**, **Vocals**, or **Percussion**, then apply the assignment. Spatial regions and musical channels are independent: any selected group can receive any channel. Divider placement lasts while the Assign panel remains open; assignments are saved by the server.

Column-only devices remain explicitly selectable below the map, but are excluded from spatial selections because their row positions are unknown. Older or unresolved devices are not silently given invented coordinates.

## Verified local sample

The 2026-09-19 four-device recording was reprocessed with the stage-facing full-frame preset. All four decoded IDs (14, 15, 17, 21) have plotted coordinates in map revision 10. Clicking, box selection, and divider groups of 2/1/1 were verified in the live operator console. Device 17 was held higher in the recording and appears farther back in this approximate layout; actual venue seat accuracy remains a physical calibration check.
