"""Screen candidates and conservative, spatially gated motion association."""

from collections import defaultdict
from dataclasses import dataclass, field
import math

import cv2
import numpy as np

from .sampling import MIN_PHASE_SAMPLES
from .video import read_frames


@dataclass(slots=True)
class Sample:
    pts_ms: float
    x: float
    y: float
    width: int
    height: int
    rgb: tuple[float, float, float]


@dataclass
class Track:
    track_id: str
    samples: list[Sample] = field(default_factory=list)
    reasons: set[str] = field(default_factory=set)


@dataclass
class CameraScan:
    tracks: list[Track]
    width: int
    height: int
    frame_count: int
    preview: np.ndarray
    preview_pts_ms: float
    discarded_fragments: int = 0


def _screen_components(rgb, pts_ms, mask):
    # Trace boundaries once, then measure each small ROI instead of allocating
    # and scanning a full-resolution integer label image for every 4K frame.
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    for index, contour in enumerate(contours):
        if hierarchy[0, index, 3] != -1:
            continue
        x, y, width, height = cv2.boundingRect(contour)
        if min(width, height) < 4 or not 0.2 <= width / height <= 5:
            continue
        component = np.zeros((height, width), np.uint8)
        boundaries = [contour]
        child = hierarchy[0, index, 2]
        while child != -1:
            boundaries.append(contours[child])
            child = hierarchy[0, child, 0]
        # Even/odd fill preserves holes; nested islands have their own candidate.
        cv2.drawContours(component, boundaries, -1, 255, cv2.FILLED, offset=(-x, -y))
        moments = cv2.moments(component, binaryImage=True)
        area = moments["m00"]
        if (area < 12 or
                area > rgb.shape[0] * rgb.shape[1] * 0.15 or
                area / (width * height) < 0.35):
            continue
        pad_x, pad_y = max(1, width // 5), max(1, height // 5)
        region = rgb[y+pad_y:y+height-pad_y, x+pad_x:x+width-pad_x]
        region_mask = component[pad_y:height-pad_y, pad_x:width-pad_x]
        pixels = region[region_mask != 0]
        if len(pixels) < 4:
            continue
        color = tuple(float(value) for value in np.median(pixels, axis=0))
        center = (x + moments["m10"] / area, y + moments["m01"] / area)
        yield Sample(pts_ms, *center, width, height, color), (x, y, width, height), component


def detect_screens(rgb, pts_ms, excluded):
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    preferred = np.zeros(rgb.shape[:2], np.int32)
    core_areas = []
    screens = []
    # Bright emissive cores survive washed-out amber pilots and separate blue
    # screens from dim clothing/glare. Keep the original dim-screen path too.
    # Color values here locate candidates; identity still uses measured pilots.
    for bright, lower in ((True, (0, 25, 190)), (False, (0, 55, 50))):
        mask = cv2.inRange(hsv, lower, (179, 255, 255))
        mask[excluded != 0] = 0
        # Remove thin glow bridges without enlarging or joining nearby screens.
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        for sample, (x, y, width, height), component in _screen_components(rgb, pts_ms, mask):
            claimed = preferred[y:y+height, x:x+width]
            inside = component != 0
            if not bright:
                labels, counts = np.unique(claimed[inside], return_counts=True)
                overlaps = [(int(label)-1, count) for label, count in zip(labels, counts) if label]
                if overlaps:
                    # A compressed/dim screen can have only a small bright seed.
                    # Recover its full footprint only near the brightness cutoff,
                    # when one core is almost entirely contained and the
                    # surrounding component is small. Strong cores stand alone.
                    # Large clothing/glare halos never replace emissive cores.
                    if len(overlaps) == 1:
                        index, overlap = overlaps[0]
                        core = screens[index]
                        if (max(core.rgb) < 210 and overlap >= core_areas[index] * 0.8 and
                                width * height <= core.width * core.height * 4):
                            screens[index] = sample
                    continue  # A core must not compete with its own dim halo.
            screens.append(sample)
            if bright:
                claimed[inside] = len(screens)
                core_areas.append(np.count_nonzero(inside))
            if len(screens) > 4096:
                raise ValueError("Too many screen candidates; add stage/light exclusion ROIs")
    return screens


def associate(tracks, active, detections, pts_ms, track_id_offset=0):
    # Fixed spatial bins avoid an audience-size squared assignment matrix.
    grid = defaultdict(list)
    predictions = {}
    for index in active:
        samples = tracks[index].samples
        last = samples[-1]
        if pts_ms - last.pts_ms > 350:
            continue
        x, y = last.x, last.y
        if len(samples) >= 2:
            previous = samples[-2]
            ratio = min(3.0, (pts_ms - last.pts_ms) / (last.pts_ms - previous.pts_ms))
            x += (last.x - previous.x) * ratio
            y += (last.y - previous.y) * ratio
        radius = min(40.0, max(8.0, max(last.width, last.height) * 0.8))
        predictions[index] = (x, y, radius)
        grid[(math.floor(x / 40), math.floor(y / 40))].append(index)
    matches = defaultdict(list)
    reverse = defaultdict(list)
    for detection_index, detection in enumerate(detections):
        gx, gy = math.floor(detection.x / 40), math.floor(detection.y / 40)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for index in grid[(gx + dx, gy + dy)]:
                    x, y, radius = predictions[index]
                    last = tracks[index].samples[-1]
                    # Proximity alone lets a dim clothing fragment steal a phone
                    # or make it ambiguous. Require compatible footprint and
                    # brightness, without assuming either pilot's hue.
                    area_ratio = detection.width * detection.height / (last.width * last.height)
                    brightness = (max(detection.rgb), max(last.rgb))
                    overlap_width = max(0, min(x + last.width / 2, detection.x + detection.width / 2)
                                        - max(x - last.width / 2, detection.x - detection.width / 2))
                    overlap_height = max(0, min(y + last.height / 2, detection.y + detection.height / 2)
                                         - max(y - last.height / 2, detection.y - detection.height / 2))
                    smaller_area = min(last.width * last.height, detection.width * detection.height)
                    if (math.hypot(detection.x - x, detection.y - y) <= radius and
                            0.35 <= area_ratio <= 4 and
                            min(brightness) >= 0.6 * max(brightness) and
                            overlap_width * overlap_height >= smaller_area * 0.2):
                        matches[detection_index].append(index)
                        reverse[index].append(detection_index)
    next_active = set(predictions)
    for detection_index, detection in enumerate(detections):
        candidates = matches[detection_index]
        if len(candidates) == 1 and len(reverse[candidates[0]]) == 1:
            index = candidates[0]
            # A cover/uncover cycle must return to the original footprint without
            # looking like a two-screen merge relative to the last half-screen.
            original = tracks[index].samples[0]
            area_ratio = detection.width * detection.height / (original.width * original.height)
            if not 0.35 <= area_ratio <= 1.8:
                tracks[index].reasons.add("abrupt screen size change")
            tracks[index].samples.append(detection)
        elif candidates:
            for index in candidates:
                tracks[index].reasons.add("ambiguous screen association or merge")
            # Do not create a new track from a merged/crossing candidate.
        else:
            if len(tracks) >= 8192:
                raise ValueError("Too many screen tracks; inspect exclusions or camera motion")
            index = len(tracks)
            tracks.append(Track(f"screen-{index + track_id_offset}", [detection]))
            next_active.add(index)
    return next_active


def retire_fragments(tracks, active, pts_ms):
    """Release expired fragments that can never meet the existing decoder minimum.

    Keep active tracks and every potentially decodable track, including ambiguous
    ones. Compaction must remap active indices without recycling public track IDs.
    """
    retained, next_active = [], set()
    for index, track in enumerate(tracks):
        if (pts_ms - track.samples[-1].pts_ms > 350 and
                len(track.samples) < MIN_PHASE_SAMPLES):
            continue
        if index in active:
            next_active.add(len(retained))
        retained.append(track)
    removed = len(tracks) - len(retained)
    tracks[:] = retained
    return next_active, removed


def scan_camera(path, camera, progress=None):
    tracks, active = [], set()
    excluded = preview = None
    width = height = frame_count = best_count = 0
    preview_pts = 0.0
    discarded_fragments = 0
    for pts_ms, rgb in read_frames(path, camera["rotationDegrees"]):
        if excluded is None:
            height, width = rgb.shape[:2]
            excluded = np.zeros((height, width), np.uint8)
            for polygon in camera["exclusionRois"]:
                points = np.array([[p["x"], p["y"]] for p in polygon], dtype=np.float64)
                if (not np.isfinite(points).all() or (points < 0).any() or
                        (points[:, 0] >= width).any() or (points[:, 1] >= height).any()):
                    raise ValueError("Exclusion ROI lies outside rotated video dimensions")
                cv2.fillPoly(excluded, [points.round().astype(np.int32)], 255)
        elif rgb.shape[:2] != (height, width):
            raise ValueError("Video dimensions changed during capture")
        detections = detect_screens(rgb, pts_ms, excluded)
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
    return CameraScan(tracks, width, height, frame_count, preview, preview_pts, discarded_fragments)
