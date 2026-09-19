# Explicit camera layout and independent audience regions

Date / author / team: 2026-09-19, integration captain.
Status: accepted under the user's mapping/integration request.
Affected teams: admin-console, otc-localization. No wire contract change.

## Context

Four optical identities were decoded correctly, but the upload had null anchors, so the worker returned optical-column/coarse records. The canvas correctly omitted null coordinates but provided no useful explanation or column-only fallback. The user confirmed the cameras face from the stage toward the audience and requested mapping with one to three cameras plus selectable left/center/right groups.

## Decision

Preserve decoder v1.5 and the existing manual-anchors transform. Expose camera calibration using the local video or the processed full-resolution preview, preserving uploaded geometry after reload. Default the explicit full-frame layout preset to stage-facing orientation: image-right becomes audience-left, and image-bottom becomes audience-front. Label this preset approximate; it is not measured seat geometry. Four known seating corners remain the perspective-calibration workflow. Validate incomplete/crossed/degenerate anchors before submitting, save edits before processing, and block committing an old candidate when geometry is dirty.

Each available camera maps independently to its primary column's third; absent cameras do not prevent localization of the available views. Localized dots are labeled and selectable by click, box or lasso. Two movable vertical lines define disjoint left/center/right selections returning explicit IDs plus mapRevision. These regions are independent of the three musical channels, Melody/Vocals/Percussion. Unknown positions remain null, with column-only IDs listed outside the map.

## Alternatives and consequences

Automatically inventing rows from optical IDs or relabeling column-only evidence as measured seats would hide uncertainty and is rejected. Automatic full-frame anchors would conceal the mapping assumption; an operator must select the preset explicitly. No camera reconstruction, stereo pairing or global schema migration is introduced.

Phone height and non-planar seating still affect inferred depth. In the actual four-device sample, device 17 held overhead projects farther back than nearby lower screens. Known-corner calibration, consistent phone height and venue orientation checks remain necessary. Divider positions are local to the open Assign panel; accepted channel assignments are durable. See the [verification journal](../teams/integration/journal/20260919-seat-map-selection.md) and [operator guide](../../docs/audience-mapping.md).
