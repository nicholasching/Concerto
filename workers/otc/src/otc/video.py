"""Streaming decoded RGB frames with clip-relative presentation timestamps."""

import hashlib
import math
from pathlib import Path

import av
import numpy as np


def verify_video(path: Path, expected_sha256: str) -> None:
    if not path.is_file():
        raise ValueError(f"Video file does not exist: {path}")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected_sha256:
        raise ValueError(f"Video SHA-256 mismatch: {path}")


def read_frames(path: Path, rotation_degrees: int = 0):
    """Apply manifest rotation clockwise, once; never infer timing from FPS.

    PyAV exposes decoded pixels without applying display-matrix rotation here.
    The caller must resolve camera orientation into rotationDegrees beforehand.
    """
    if rotation_degrees not in (0, 90, 180, 270):
        raise ValueError("Rotation must be 0, 90, 180 or 270")
    first_pts = previous_pts = None
    frames = 0
    with av.open(str(path)) as container:
        if not container.streams.video:
            raise ValueError(f"No video stream: {path}")
        stream = container.streams.video[0]
        stream.codec_context.thread_count = 2
        stream.codec_context.thread_type = "AUTO"  # Offline PTS-order decode across frames too.
        for frame in container.decode(stream):
            if frame.pts is None or frame.time_base is None:
                raise ValueError("Video frame lacks a presentation timestamp")
            pts = float(frame.pts * frame.time_base) * 1000
            if not math.isfinite(pts) or (previous_pts is not None and pts <= previous_pts):
                raise ValueError("Video presentation timestamps must strictly increase")
            if first_pts is None:
                first_pts = pts
            previous_pts = pts
            relative_pts = pts - first_pts
            if relative_pts > 60000:
                raise ValueError("Calibration clips must be at most 60 seconds")
            if frame.width * frame.height > 16_000_000:
                raise ValueError("Frame exceeds the 16-megapixel worker limit")
            if frame.is_corrupt:
                continue  # Missing evidence, never invented replacement frames.
            rgb = frame.to_ndarray(format="rgb24")
            if rotation_degrees:
                rgb = np.ascontiguousarray(np.rot90(rgb, -(rotation_degrees // 90)))
            frames += 1
            yield relative_pts, rgb
    if not frames:
        raise ValueError("No usable video frames")
