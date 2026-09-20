"""Render the existing OTC screen tracks as a local diagnostic video."""

from collections import defaultdict
from dataclasses import dataclass
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
from .tracking import _screen_components, associate, retire_fragments
from .video import read_frames


CYAN = (0, 220, 255)
GREEN = (0, 220, 0)
MAGENTA = (255, 0, 255)


@dataclass
class BoxingScan:
    tracks: list
    width: int
    height: int
    frame_count: int
    discarded_fragments: int
    flash_by_frame: dict
    qualified_by_frame: dict


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


def _scan_red_blue(path, rotation_degrees, progress):
    tracks, active, qualified_track_ids = [], set(), set()
    previous_value = None
    width = height = frame_count = discarded_fragments = 0
    flash_by_frame, qualified_by_frame = defaultdict(list), defaultdict(list)
    for pts_ms, rgb in read_frames(path, rotation_degrees):
        if width == 0:
            height, width = rgb.shape[:2]
        elif rgb.shape[:2] != (height, width):
            raise ValueError("Video dimensions changed during capture")
        red, blue = palette_masks(rgb)
        palette = cv2.bitwise_or(red, blue)
        flash, previous_value = flash_seed_mask(rgb, previous_value)
        flash_detections = _masked_screens(rgb, pts_ms, flash)
        palette_detections = _masked_screens(rgb, pts_ms, palette)
        active, removed = retire_fragments(tracks, active, pts_ms)
        discarded_fragments += removed
        active = associate(tracks, active, flash_detections + palette_detections, pts_ms,
                           discarded_fragments)
        for track in tracks:
            if track_has_both_palette_colors(track, now_ms=pts_ms):
                qualified_track_ids.add(track.track_id)
        carry_qualification_to_current_fragment(tracks, qualified_track_ids, pts_ms)
        key = _frame_key(pts_ms)
        flash_by_frame[key].extend(flash_detections)
        qualified_by_frame[key].extend(
            (track.track_id, track.samples[-1]) for track in tracks
            if track.track_id in qualified_track_ids and
            pts_ms - track.samples[-1].pts_ms <= SELECTED_TRACK_MAX_AGE_MS
        )
        frame_count += 1
        if progress and frame_count % 90 == 0:
            progress("detect", frame_count, f"Tracked {frame_count} frames")
    return BoxingScan(tracks, width, height, frame_count, discarded_fragments,
                      dict(flash_by_frame), dict(qualified_by_frame))


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

    scan = _scan_red_blue(input_path, rotation_degrees, progress)
    boxes_by_frame = defaultdict(list)
    for track in scan.tracks:
        for sample in track.samples:
            boxes_by_frame[_frame_key(sample.pts_ms)].append((track.track_id, sample))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    frames_written = boxes_drawn = 0
    qualified_track_ids = set()
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
                annotated = cv2.convertScaleAbs(rgb, alpha=.25)
                annotated[palette != 0] = rgb[palette != 0]
                for sample in scan.flash_by_frame.get(key, []):
                    _rectangle(annotated, sample, MAGENTA)
                for _track_id, sample in boxes_by_frame.get(key, []):
                    cv2.circle(annotated, (round(sample.x), round(sample.y)), 3, CYAN, -1)
                for track_id, sample in scan.qualified_by_frame.get(key, []):
                    _rectangle(annotated, sample, GREEN, "red + blue")
                    qualified_track_ids.add(track_id)
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
        "qualifiedTrackCount": len(qualified_track_ids),
        "boxesDrawn": boxes_drawn,
        "discardedFragments": scan.discarded_fragments,
        "width": scan.width,
        "height": scan.height,
    }
    if progress:
        progress("complete", frames_written, "Annotated boxing video written")
    return summary
