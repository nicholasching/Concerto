"""Render the existing OTC screen tracks as a local diagnostic video."""

from collections import defaultdict
from dataclasses import dataclass
from fractions import Fraction
from math import hypot
from pathlib import Path
import tempfile

import av
import cv2

from .red_blue_diagnostic import (
    FlashSequence,
    SELECTED_TRACK_MAX_AGE_MS,
    carry_qualification_to_current_fragment,
    flash_seed_mask,
    palette_masks,
)
from .tracking import Sample, Track, _screen_components, scan_camera
from .video import read_frames


CYAN = (0, 220, 255)
GREEN = (0, 220, 0)
MAGENTA = (255, 0, 255)
MIN_PALETTE_TRACK_COVERAGE = .10
MIN_PALETTE_COMPONENT_OVERLAP = .65
RECOVERY_WINDOW_MS = 750
RECOVERY_MIN_AREA_RATIO = .5
RECOVERY_MAX_AREA_RATIO = 2.0
RECOVERY_MIN_OVERLAP = .10


@dataclass
class ConfirmedSession:
    """One logical flashing phone, which may span short raw-track fragments."""

    session_id: str
    track_id: str
    last_sample: Sample
    last_seen_ms: float
    previous_sample: Sample | None = None


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


def _session_prediction(session, pts_ms):
    """Project a recently lost footprint using its last observed motion."""
    last = session.last_sample
    previous = session.previous_sample
    if previous is None or last.pts_ms <= previous.pts_ms:
        return last.x, last.y
    elapsed = min(pts_ms - last.pts_ms, RECOVERY_WINDOW_MS)
    velocity_x = (last.x - previous.x) / (last.pts_ms - previous.pts_ms)
    velocity_y = (last.y - previous.y) / (last.pts_ms - previous.pts_ms)
    return last.x + velocity_x * elapsed, last.y + velocity_y * elapsed


def _matches_recovery(session, sample, pts_ms):
    """Use size, overlap, and short-term motion to reject a different phone."""
    previous = session.last_sample
    area_ratio = sample.width * sample.height / (previous.width * previous.height)
    if not RECOVERY_MIN_AREA_RATIO <= area_ratio <= RECOVERY_MAX_AREA_RATIO:
        return False
    overlap = _overlap_area(previous, sample)
    smaller_area = min(previous.width * previous.height, sample.width * sample.height)
    if overlap < smaller_area * RECOVERY_MIN_OVERLAP:
        return False
    predicted_x, predicted_y = _session_prediction(session, pts_ms)
    radius = max(16.0, max(previous.width, previous.height, sample.width, sample.height) * 1.25)
    return hypot(sample.x - predicted_x, sample.y - predicted_y) <= radius


def _recovery_session(sessions, active_track_ids, sample, pts_ms):
    """Return a session only when one unambiguous recently lost match exists."""
    candidates = [
        session for session in sessions.values()
        if (session.track_id not in active_track_ids and
            0 < pts_ms - session.last_seen_ms <= RECOVERY_WINDOW_MS and
            _matches_recovery(session, sample, pts_ms))
    ]
    return candidates[0] if len(candidates) == 1 else None


def _attach_session(session_by_track, qualified_track_ids, session, track_id, sample, pts_ms):
    """Move a logical session to its current raw track without double counting."""
    if session.track_id != track_id:
        session_by_track.pop(session.track_id, None)
        qualified_track_ids.discard(session.track_id)
        session.previous_sample = None
    else:
        session.previous_sample = session.last_sample
    session.track_id = track_id
    session.last_sample = sample
    session.last_seen_ms = pts_ms
    session_by_track[track_id] = session.session_id
    qualified_track_ids.add(track_id)


def _palette_phase_by_track(rgb, pts_ms, red, blue, screen_tracks):
    """Assign palette components exclusively, then classify each screen frame.

    Colour inside a broad candidate is not enough: the coloured component must
    cover a material part of the screen box and mostly lie within it. This
    prevents a large wall/door track from inheriting a small phone's colours.
    Red and blue assigned to one track in the same frame are ``mixed`` rather
    than a transition, so a static split-colour screen cannot qualify.
    """
    best_by_track = {}
    for color, palette_mask in (("red", red), ("blue", blue)):
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
            score, coverage, track_id, _screen = max(choices, key=lambda choice: choice[:2])
            per_color = best_by_track.setdefault(track_id, {})
            previous = per_color.get(color)
            if previous is None or (score, coverage) > previous:
                per_color[color] = (score, coverage)
    return {
        track_id: "mixed" if len(colors) > 1 else next(iter(colors))
        for track_id, colors in best_by_track.items()
    }


def box_video(input_path, output_path, *, rotation_degrees=0, progress=None):
    """Render the approved red/blue diagnostic monitor behavior for an uploaded clip.

    Cyan dots are current visual tracks. A green rectangle requires a true
    red -> blue -> red -> blue sequence and persists while tracked. Neither
    result is an accepted device identity or a map location.
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
    qualification_tracks, phase_by_track = {}, {}
    qualified_track_ids, seen_qualified_track_ids = set(), set()
    sessions, session_by_track = {}, {}
    next_session_number = 0
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
                active_track_ids = {track_id for track_id, _sample in frame_tracks}
                palette_phases = _palette_phase_by_track(
                    rgb, pts_ms, red, blue, frame_tracks
                )
                # Keep the raw box currently carrying each recovered session up
                # to date before considering new fragments.
                for track_id, sample in frame_tracks:
                    session_id = session_by_track.get(track_id)
                    if session_id:
                        _attach_session(session_by_track, qualified_track_ids,
                                        sessions[session_id], track_id, sample, pts_ms)
                # A short loss may make a new raw track for the same phone.
                # Reclaim it only when one inactive session is a clear match.
                for track_id, sample in frame_tracks:
                    if track_id in session_by_track:
                        continue
                    session = _recovery_session(sessions, active_track_ids, sample, pts_ms)
                    if session:
                        _attach_session(session_by_track, qualified_track_ids,
                                        session, track_id, sample, pts_ms)
                for track_id, sample in frame_tracks:
                    cv2.circle(annotated, (round(sample.x), round(sample.y)), 3, CYAN, -1)
                    qualification_tracks.setdefault(track_id, Track(track_id)).samples.append(
                        Sample(sample.pts_ms, sample.x, sample.y, sample.width, sample.height, (0, 0, 0))
                    )
                    sequence = phase_by_track.setdefault(track_id, FlashSequence())
                    if sequence.observe(palette_phases.get(track_id, "none"), pts_ms):
                        session_id = session_by_track.get(track_id)
                        if session_id is None:
                            session = _recovery_session(sessions, active_track_ids, sample, pts_ms)
                            if session is None:
                                next_session_number += 1
                                session = ConfirmedSession(
                                    f"flash-{next_session_number}", track_id, sample, pts_ms
                                )
                                sessions[session.session_id] = session
                            _attach_session(session_by_track, qualified_track_ids,
                                            session, track_id, sample, pts_ms)
                current_tracks = list(qualification_tracks.values())
                for parent_id, child_id in carry_qualification_to_current_fragment(
                    current_tracks, qualified_track_ids, pts_ms
                ):
                    session_id = session_by_track.get(parent_id)
                    child_sample = dict(frame_tracks).get(child_id)
                    if session_id and child_sample:
                        _attach_session(session_by_track, qualified_track_ids,
                                        sessions[session_id], child_id, child_sample, pts_ms)
                for track in current_tracks:
                    if (track.track_id not in qualified_track_ids or
                            pts_ms - track.samples[-1].pts_ms > SELECTED_TRACK_MAX_AGE_MS):
                        continue
                    track_id, sample = track.track_id, track.samples[-1]
                    _rectangle(annotated, sample, GREEN, "flash sequence")
                    seen_qualified_track_ids.add(session_by_track[track_id])
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
