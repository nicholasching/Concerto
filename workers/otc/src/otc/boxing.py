"""Render local red/blue palette tracks as a diagnostic video."""

from contextlib import ExitStack, closing
from dataclasses import dataclass
from fractions import Fraction
from functools import partial
from math import hypot
from pathlib import Path
import tempfile

import av
import cv2
import numpy as np

from .red_blue_diagnostic import (
    DEFAULT_PALETTE_SETTINGS,
    FlashSequence,
    PaletteSettings,
    carry_qualification_to_current_fragment,
    palette_masks,
)
from .frame_worker import detected_frames
from .tracking import CameraScan, Sample, Track, _screen_components, associate, retire_fragments
from .video import read_frames


GREEN = (0, 220, 0)
RED = (255, 80, 80)
BLUE = (80, 160, 255)
MIN_PALETTE_TRACK_COVERAGE = .10
MIN_PALETTE_COMPONENT_OVERLAP = .65
RECOVERY_WINDOW_MS = 750
RECOVERY_MIN_AREA_RATIO = .5
RECOVERY_MAX_AREA_RATIO = 2.0
RECOVERY_MIN_OVERLAP = .10
GREEN_BOX_HOLD_MS = 750
AMBER_PALETTE_SETTINGS = PaletteSettings(red_hue=21)


@dataclass(frozen=True)
class PaletteEvidence:
    """Exclusive red/blue components assigned to one screen in one frame."""

    red: Sample | None = None
    blue: Sample | None = None

    @property
    def phase(self):
        if self.red is not None and self.blue is not None:
            return "mixed"
        if self.red is not None:
            return "red"
        if self.blue is not None:
            return "blue"
        return "none"


@dataclass
class ConfirmedSession:
    """One logical flashing phone, which may span short raw-track fragments."""

    session_id: str
    track_id: str
    last_sample: Sample
    last_seen_ms: float
    previous_sample: Sample | None = None
    red_evidence: Sample | None = None
    blue_evidence: Sample | None = None


def _masked_screens(rgb, pts_ms, mask):
    """Use the current worker's native component filtering on a diagnostic mask."""
    return [sample for sample, _bounds, _component in _screen_components(rgb, pts_ms, mask)]


def _palette_screens(rgb, pts_ms, red, blue):
    """Use only saturated red/blue components as track candidates."""
    return _masked_screens(rgb, pts_ms, cv2.bitwise_or(red, blue))


def _palette_settings(zero_color):
    if zero_color.upper() == "#FF0000":
        return DEFAULT_PALETTE_SETTINGS
    return AMBER_PALETTE_SETTINGS


def _phone_detection_components(rgb, pts_ms, _excluded, *, settings):
    """Run the phone-detection branch's palette-only candidate step.

    This top-level callable is intentionally spawn-safe for main's bounded
    frame-analysis pool. It has no generic bright/dim screen fallback.
    """
    red, blue = palette_masks(rgb, settings=settings)
    return _palette_screens(rgb, pts_ms, red, blue)


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


def _remember_palette_evidence(session, evidence):
    """Keep the latest qualifying components visible after a phase changes."""
    if evidence.red is not None:
        session.red_evidence = evidence.red
    if evidence.blue is not None:
        session.blue_evidence = evidence.blue


def _palette_evidence_by_track(rgb, pts_ms, red, blue, screen_tracks):
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
                per_color[color] = (score, coverage, component)
    return {
        track_id: PaletteEvidence(
            red=colors.get("red", (None, None, None))[2],
            blue=colors.get("blue", (None, None, None))[2],
        )
        for track_id, colors in best_by_track.items()
    }


def scan_phone_detection_camera(path, camera, progress=None, *, frame_workers=1,
                                zero_color="#FF0000"):
    """Return only sessions confirmed by the current phone-detection algorithm.

    Its candidate source, ordered palette qualification, exclusive evidence,
    fragment handoff and recovered-session behavior are the same primitives as
    ``box_video``. Frame component extraction remains parallelized through
    main's bounded pool; stateful association stays PTS-ordered in this process.
    """
    settings = _palette_settings(zero_color)
    detect = partial(_phone_detection_components, settings=settings)
    tracks, active, phase_by_track = [], set(), {}
    discarded_fragments = 0
    qualified_track_ids = set()
    sessions, session_by_track, session_samples = {}, {}, {}
    next_session_number = 0
    preview = None
    preview_pts = 0.0
    width = height = frame_count = best_count = 0
    frames = detected_frames(read_frames(path, camera["rotationDegrees"]),
                             camera["exclusionRois"], detect, frame_workers)

    with closing(frames):
        for pts_ms, rgb, detections in frames:
            height, width = rgb.shape[:2]
            active, removed = retire_fragments(tracks, active, pts_ms)
            discarded_fragments += removed
            active = associate(tracks, active, detections, pts_ms, discarded_fragments)
            if preview is None or len(detections) > best_count or (
                len(detections) == best_count and frame_count % 30 == 0
            ):
                preview, preview_pts, best_count = rgb.copy(), pts_ms, len(detections)
            frame_count += 1
            if progress and frame_count % 90 == 0:
                progress(frame_count, pts_ms)

            red, blue = palette_masks(rgb, settings=settings)
            frame_tracks = [
                (track.track_id, track.samples[-1])
                for track in tracks if track.samples[-1].pts_ms == pts_ms
            ]
            current = dict(frame_tracks)
            source_tracks = {track.track_id: track for track in tracks}
            active_track_ids = set(current)
            palette_evidence = _palette_evidence_by_track(
                rgb, pts_ms, red, blue, frame_tracks
            )

            def remember(session, track_id, sample):
                samples = session_samples.setdefault(session.session_id, [])
                if not samples:
                    samples.extend(source_tracks[track_id].samples)
                elif samples[-1].pts_ms < sample.pts_ms:
                    samples.append(sample)

            for track_id, sample in frame_tracks:
                session_id = session_by_track.get(track_id)
                if session_id:
                    session = sessions[session_id]
                    _attach_session(session_by_track, qualified_track_ids,
                                    session, track_id, sample, pts_ms)
                    _remember_palette_evidence(
                        session, palette_evidence.get(track_id, PaletteEvidence())
                    )
                    remember(session, track_id, sample)

            for track_id, sample in frame_tracks:
                if track_id in session_by_track:
                    continue
                session = _recovery_session(sessions, active_track_ids, sample, pts_ms)
                if session:
                    _attach_session(session_by_track, qualified_track_ids,
                                    session, track_id, sample, pts_ms)
                    _remember_palette_evidence(
                        session, palette_evidence.get(track_id, PaletteEvidence())
                    )
                    remember(session, track_id, sample)

            for track_id, sample in frame_tracks:
                sequence = phase_by_track.setdefault(track_id, FlashSequence())
                evidence = palette_evidence.get(track_id, PaletteEvidence())
                if sequence.observe(evidence.phase, pts_ms):
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
                        _remember_palette_evidence(session, evidence)
                        remember(session, track_id, sample)

            for parent_id, child_id in carry_qualification_to_current_fragment(
                tracks, qualified_track_ids, pts_ms
            ):
                session_id = session_by_track.get(parent_id)
                child_sample = current.get(child_id)
                if session_id and child_sample:
                    session = sessions[session_id]
                    _attach_session(session_by_track, qualified_track_ids,
                                    session, child_id, child_sample, pts_ms)
                    _remember_palette_evidence(
                        session, palette_evidence.get(child_id, PaletteEvidence())
                    )
                    remember(session, child_id, child_sample)

    confirmed = [
        Track(session.session_id, session_samples[session.session_id])
        for session in sessions.values()
    ]
    return CameraScan(confirmed, width, height, frame_count, preview, preview_pts,
                      discarded_fragments)


def _mask_preview(rgb, mask, label):
    """Render an HSV palette mask as a readable diagnostic video frame."""
    preview = np.zeros_like(rgb)
    preview[mask != 0] = rgb[mask != 0]
    cv2.putText(preview, label, (18, 32), cv2.FONT_HERSHEY_SIMPLEX,
                .65, (255, 255, 255), 2, cv2.LINE_AA)
    return preview


def _write_video_frame(destination, stream, rgb, pts_ms):
    frame = av.VideoFrame.from_ndarray(rgb, format="rgb24")
    frame.pts = round(pts_ms)
    frame.time_base = Fraction(1, 1000)
    for packet in stream.encode(frame):
        destination.mux(packet)


def box_video(input_path, output_path, *, rotation_degrees=0, progress=None,
              verbose_output_dir=None):
    """Render the approved red/blue diagnostic monitor behavior for an uploaded clip.

    Only red/blue HSV components can create tracks. A green rectangle requires
    a true red -> blue -> red -> blue sequence. Neither result is an accepted
    device identity or a map location.
    """
    input_path = Path(input_path).resolve()
    output_path = Path(output_path).resolve()
    if output_path.exists():
        raise ValueError("Output already exists; use a new path for each boxing attempt")
    if input_path == output_path:
        raise ValueError("Output must not overwrite the source video")
    verbose_paths = {}
    if verbose_output_dir is not None:
        verbose_output_dir = Path(verbose_output_dir).resolve()
        verbose_paths = {
            "red": verbose_output_dir / "red-mask.mp4",
            "blue": verbose_output_dir / "blue-mask.mp4",
        }
        if any(path.exists() for path in verbose_paths.values()):
            raise ValueError("Verbose output already exists; use a new boxing attempt")
    if progress:
        progress("track", 0, "Tracking red/blue palette components")

    targets = {"boxed": output_path, **verbose_paths}
    for target in targets.values():
        target.parent.mkdir(parents=True, exist_ok=True)
    temporary_paths = {}
    frames_written = boxes_drawn = 0
    tracks, active, phase_by_track = [], set(), {}
    discarded_fragments = 0
    qualified_track_ids, seen_qualified_track_ids = set(), set()
    sessions, session_by_track = {}, {}
    next_session_number = 0
    width = height = 0
    try:
        for name, target_path in targets.items():
            with tempfile.NamedTemporaryFile(dir=target_path.parent, suffix=".mp4", delete=False) as target:
                temporary_paths[name] = Path(target.name)
        with ExitStack() as stack:
            destinations = {
                name: stack.enter_context(av.open(str(temporary), "w"))
                for name, temporary in temporary_paths.items()
            }
            streams = {}
            for pts_ms, rgb in read_frames(input_path, rotation_degrees):
                if not streams:
                    height, width = rgb.shape[:2]
                    for name, destination in destinations.items():
                        stream = destination.add_stream("libx264", rate=30)
                        stream.width, stream.height = width, height
                        stream.pix_fmt = "yuv420p"
                        stream.time_base = Fraction(1, 1000)
                        streams[name] = stream
                red, blue = palette_masks(rgb)
                palette = cv2.bitwise_or(red, blue)
                active, removed = retire_fragments(tracks, active, pts_ms)
                discarded_fragments += removed
                active = associate(
                    tracks, active, _palette_screens(rgb, pts_ms, red, blue), pts_ms,
                    discarded_fragments,
                )
                annotated = cv2.convertScaleAbs(rgb, alpha=.25)
                annotated[palette != 0] = rgb[palette != 0]
                frame_tracks = [
                    (track.track_id, track.samples[-1])
                    for track in tracks if track.samples[-1].pts_ms == pts_ms
                ]
                active_track_ids = {track_id for track_id, _sample in frame_tracks}
                palette_evidence = _palette_evidence_by_track(
                    rgb, pts_ms, red, blue, frame_tracks
                )
                # Keep the raw box currently carrying each recovered session up
                # to date before considering new fragments.
                for track_id, sample in frame_tracks:
                    session_id = session_by_track.get(track_id)
                    if session_id:
                        session = sessions[session_id]
                        _attach_session(session_by_track, qualified_track_ids,
                                        session, track_id, sample, pts_ms)
                        _remember_palette_evidence(
                            session, palette_evidence.get(track_id, PaletteEvidence())
                        )
                # A short loss may make a new raw track for the same phone.
                # Reclaim it only when one inactive session is a clear match.
                for track_id, sample in frame_tracks:
                    if track_id in session_by_track:
                        continue
                    session = _recovery_session(sessions, active_track_ids, sample, pts_ms)
                    if session:
                        _attach_session(session_by_track, qualified_track_ids,
                                        session, track_id, sample, pts_ms)
                        _remember_palette_evidence(
                            session, palette_evidence.get(track_id, PaletteEvidence())
                        )
                for track_id, sample in frame_tracks:
                    sequence = phase_by_track.setdefault(track_id, FlashSequence())
                    evidence = palette_evidence.get(track_id, PaletteEvidence())
                    if sequence.observe(evidence.phase, pts_ms):
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
                            _remember_palette_evidence(session, evidence)
                for parent_id, child_id in carry_qualification_to_current_fragment(
                    tracks, qualified_track_ids, pts_ms
                ):
                    session_id = session_by_track.get(parent_id)
                    child_sample = dict(frame_tracks).get(child_id)
                    if session_id and child_sample:
                        session = sessions[session_id]
                        _attach_session(session_by_track, qualified_track_ids,
                                        session, child_id, child_sample, pts_ms)
                        _remember_palette_evidence(
                            session, palette_evidence.get(child_id, PaletteEvidence())
                        )
                for session in sessions.values():
                    if pts_ms - session.last_seen_ms > GREEN_BOX_HOLD_MS:
                        continue
                    _rectangle(annotated, session.last_sample, GREEN, "flash sequence")
                    if verbose_paths:
                        if session.red_evidence is not None:
                            _rectangle(annotated, session.red_evidence, RED, "red evidence")
                        if session.blue_evidence is not None:
                            _rectangle(annotated, session.blue_evidence, BLUE, "blue evidence")
                    seen_qualified_track_ids.add(session.session_id)
                    boxes_drawn += 1
                _write_video_frame(destinations["boxed"], streams["boxed"], annotated, pts_ms)
                if verbose_paths:
                    settings = DEFAULT_PALETTE_SETTINGS
                    _write_video_frame(
                        destinations["red"], streams["red"],
                        _mask_preview(
                            rgb, red,
                            f"RED MASK  H {settings.red_hue} +/- {settings.red_hue_tolerance}  "
                            f"S >= {settings.saturation}  V >= {settings.value}",
                        ), pts_ms,
                    )
                    _write_video_frame(
                        destinations["blue"], streams["blue"],
                        _mask_preview(
                            rgb, blue,
                            f"BLUE MASK  H {settings.blue_hue} +/- {settings.blue_hue_tolerance}  "
                            f"S >= {settings.saturation}  V >= {settings.value}",
                        ), pts_ms,
                    )
                frames_written += 1
                if progress and frames_written % 90 == 0:
                    progress("track", frames_written, f"Tracked {frames_written} palette frames")
            if not streams:
                raise ValueError("Video contained no decodable frames")
            for name, stream in streams.items():
                for packet in stream.encode():
                    destinations[name].mux(packet)
        for name, target_path in targets.items():
            temporary_paths[name].replace(target_path)
    finally:
        for temporary in temporary_paths.values():
            temporary.unlink(missing_ok=True)

    summary = {
        "frameCount": frames_written,
        "trackCount": len(tracks),
        "qualifiedTrackCount": len(seen_qualified_track_ids),
        "boxesDrawn": boxes_drawn,
        "discardedFragments": discarded_fragments,
        "width": width,
        "height": height,
        "verbose": bool(verbose_paths),
    }
    if progress:
        progress("complete", frames_written, "Annotated boxing video written")
    return summary
