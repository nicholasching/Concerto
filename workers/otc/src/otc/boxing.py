"""Render the existing OTC screen tracks as a local diagnostic video."""

from collections import defaultdict
from fractions import Fraction
from pathlib import Path
import tempfile

import av
import cv2

from .red_blue_diagnostic import (
    SELECTED_TRACK_MAX_AGE_MS,
    carry_qualification_to_current_fragment,
    flash_seed_mask,
    palette_masks,
    track_has_both_palette_colors,
)
from .tracking import Sample, Track, _screen_components, scan_camera
from .video import read_frames


CYAN = (0, 220, 255)
GREEN = (0, 220, 0)
MAGENTA = (255, 0, 255)
MIN_PALETTE_TRACK_COVERAGE = .10
MIN_PALETTE_COMPONENT_OVERLAP = .65


def _frame_key(pts_ms):
    """Avoid tiny repeat-decode floating point differences when matching samples to frames."""
    return round(pts_ms * 1000)


def _masked_screens(rgb, pts_ms, mask):
    """Use the current worker's native component filtering on a diagnostic mask."""
    return [sample for sample, _bounds, _component in _screen_components(rgb, pts_ms, mask)]


def _rectangle(frame, sample, color, label=None):
    height, width = frame.shape[:2]
    x0 = max(0, round(sample.x - sample.width / 2))
    y0 = max(0, round(sample.y - sample.height / 2))
    x1 = min(width - 1, x0 + sample.width)
    y1 = min(height - 1, y0 + sample.height)
    cv2.rectangle(frame, (x0, y0), (x1, y1), color, 2)
    if label:
        cv2.putText(frame, label, (x0, max(14, y0 - 5)), cv2.FONT_HERSHEY_SIMPLEX,
                    .45, color, 1, cv2.LINE_AA)


def _overlap_area(first, second):
    """Return the intersection area of two centre/width/height samples."""
    width = max(0, min(first.x + first.width / 2, second.x + second.width / 2)
                - max(first.x - first.width / 2, second.x - second.width / 2))
    height = max(0, min(first.y + first.height / 2, second.y + second.height / 2)
                 - max(first.y - first.height / 2, second.y - second.height / 2))
    return width * height


def _palette_evidence_by_track(rgb, pts_ms, red, blue, screen_tracks):
    """Assign each palette component to one compatible screen footprint.

    Colour inside a broad candidate is not enough: the coloured component must
    cover a material part of the screen box and mostly lie within it. This
    prevents a large wall/door track from inheriting a small phone's colours.
    """
    best_by_track = {}
    for palette_mask in (red, blue):
        for component, _bounds, _mask in _screen_components(rgb, pts_ms, palette_mask):
            component_area = component.width * component.height
            choices = []
            for track_id, screen in screen_tracks:
                overlap = _overlap_area(component, screen)
                screen_area = screen.width * screen.height
                coverage = overlap / screen_area
                component_overlap = overlap / component_area
                if (coverage < MIN_PALETTE_TRACK_COVERAGE or
                        component_overlap < MIN_PALETTE_COMPONENT_OVERLAP):
                    continue
                union = component_area + screen_area - overlap
                choices.append((overlap / union, coverage, track_id, screen))
            if not choices:
                continue
            # The strongest geometric match owns this coloured blob. It cannot
            # also supply red/blue evidence to a containing ghost track.
            score, coverage, track_id, screen = max(choices)
            previous = best_by_track.get(track_id)
            if previous is None or (score, coverage) > previous[:2]:
                best_by_track[track_id] = (score, coverage, Sample(
                    pts_ms, screen.x, screen.y, screen.width, screen.height, component.rgb
                ))
    return {track_id: evidence[-1] for track_id, evidence in best_by_track.items()}


def box_video(input_path, output_path, *, rotation_degrees=0, progress=None):
    """Render the approved red/blue diagnostic monitor behavior for an uploaded clip.

    Cyan dots are current visual tracks. A green `red + blue` rectangle needs
    two samples of each colour and persists while that track remains visible.
    Neither result is an accepted device identity or a map location.
    """
    input_path = Path(input_path).resolve()
    output_path = Path(output_path).resolve()
    if output_path.exists():
        raise ValueError("Output already exists; use a new path for each boxing attempt")
    if input_path == output_path:
        raise ValueError("Output must not overwrite the source video")
    if progress:
        progress("detect", 0, "Running the red/blue diagnostic tracker")

    camera = {"rotationDegrees": rotation_degrees, "exclusionRois": []}
    scan = scan_camera(
        input_path,
        camera,
        lambda frames, _pts: progress("detect", frames, f"Tracked {frames} frames") if progress else None,
    )
    boxes_by_frame = defaultdict(list)
    for track in scan.tracks:
        for sample in track.samples:
            boxes_by_frame[_frame_key(sample.pts_ms)].append((track.track_id, sample))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    frames_written = boxes_drawn = 0
    qualification_tracks, qualified_track_ids, seen_qualified_track_ids = {}, set(), set()
    previous_value = None
    try:
        with tempfile.NamedTemporaryFile(dir=output_path.parent, suffix=".mp4", delete=False) as target:
            temporary = Path(target.name)
        with av.open(str(temporary), "w") as destination:
            stream = destination.add_stream("libx264", rate=30)
            stream.width, stream.height = scan.width, scan.height
            stream.pix_fmt = "yuv420p"
            stream.time_base = Fraction(1, 1000)
            for pts_ms, rgb in read_frames(input_path, rotation_degrees):
                key = _frame_key(pts_ms)
                red, blue = palette_masks(rgb)
                palette = cv2.bitwise_or(red, blue)
                flash, previous_value = flash_seed_mask(rgb, previous_value)
                annotated = cv2.convertScaleAbs(rgb, alpha=.25)
                annotated[palette != 0] = rgb[palette != 0]
                for sample in _masked_screens(rgb, pts_ms, flash):
                    _rectangle(annotated, sample, MAGENTA)
                frame_tracks = boxes_by_frame.get(key, [])
                palette_evidence = _palette_evidence_by_track(
                    rgb, pts_ms, red, blue, frame_tracks
                )
                for track_id, sample in frame_tracks:
                    cv2.circle(annotated, (round(sample.x), round(sample.y)), 3, CYAN, -1)
                    evidence = palette_evidence.get(track_id)
                    # Qualification receives colour only from an exclusively
                    # owned, scale-compatible palette component. Generic track
                    # colour cannot turn a broad enclosing candidate green.
                    color = evidence.rgb if evidence else (0.0, 0.0, 0.0)
                    qualification_tracks.setdefault(track_id, Track(track_id)).samples.append(
                        Sample(sample.pts_ms, sample.x, sample.y, sample.width, sample.height, color)
                    )
                current_tracks = list(qualification_tracks.values())
                for track in current_tracks:
                    if track_has_both_palette_colors(track, now_ms=pts_ms):
                        qualified_track_ids.add(track.track_id)
                carry_qualification_to_current_fragment(current_tracks, qualified_track_ids, pts_ms)
                for track in current_tracks:
                    if (track.track_id not in qualified_track_ids or
                            pts_ms - track.samples[-1].pts_ms > SELECTED_TRACK_MAX_AGE_MS):
                        continue
                    track_id, sample = track.track_id, track.samples[-1]
                    _rectangle(annotated, sample, GREEN, "red + blue")
                    qualified_track_ids.add(track_id)
                    seen_qualified_track_ids.add(track_id)
                    boxes_drawn += 1
                frame = av.VideoFrame.from_ndarray(annotated, format="rgb24")
                frame.pts = round(pts_ms)
                frame.time_base = Fraction(1, 1000)
                for packet in stream.encode(frame):
                    destination.mux(packet)
                frames_written += 1
                if progress and frames_written % 90 == 0:
                    progress("render", frames_written, f"Rendered {frames_written} frames")
            for packet in stream.encode():
                destination.mux(packet)
        temporary.replace(output_path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

    summary = {
        "frameCount": frames_written,
        "trackCount": len(scan.tracks),
        "qualifiedTrackCount": len(seen_qualified_track_ids),
        "boxesDrawn": boxes_drawn,
        "discardedFragments": scan.discarded_fragments,
        "width": scan.width,
        "height": scan.height,
    }
    if progress:
        progress("complete", frames_written, "Annotated boxing video written")
    return summary
