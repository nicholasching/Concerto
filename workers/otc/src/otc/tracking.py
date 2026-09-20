"""Screen candidates and conservative, spatially gated motion association."""

from collections import defaultdict
from dataclasses import dataclass, field
import math
from statistics import median

import cv2
import numpy as np

from .sampling import MIN_PHASE_SAMPLES


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
    # Time, competing track, independently separated footprints at its birth.
    collisions: list[tuple[float, str, bool]] = field(default_factory=list)


def separate_footprints(first, second):
    """A new band inside an existing screen is not an independent second phone.

    Compare at the new fragment's birth, before later exposure bands distort the
    old track's most recent box. Fully verified competing packets still conflict
    at decode time even when one footprint contains the other.
    """
    older, newer = sorted((first, second), key=lambda track: track.samples[0].pts_ms)
    seed = newer.samples[0]
    sample = min(older.samples, key=lambda s: abs(s.pts_ms-seed.pts_ms))
    if abs(sample.pts_ms-seed.pts_ms) > 350:
        return True
    width = max(0, min(sample.x+sample.width/2, seed.x+seed.width/2)
                - max(sample.x-sample.width/2, seed.x-seed.width/2))
    height = max(0, min(sample.y+sample.height/2, seed.y+seed.height/2)
                 - max(sample.y-sample.height/2, seed.y-seed.height/2))
    return width*height < .8 * min(sample.width*sample.height, seed.width*seed.height)


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


def associate(tracks, active, detections, pts_ms, track_id_offset=0):
    # Fixed spatial bins avoid an audience-size squared assignment matrix.
    grid = defaultdict(list)
    predictions = {}
    footprints = {}
    for index in active:
        samples = tracks[index].samples
        last = samples[-1]
        if pts_ms - last.pts_ms > 350:
            continue
        recent = samples[-6:]
        width, height = median(s.width for s in recent), median(s.height for s in recent)
        footprints[index] = (width, height)
        x, y = last.x, last.y
        if len(samples) >= 2:
            # A colour transition can distort one component's centroid. A
            # single-frame velocity then extrapolates away from a stationary
            # phone for the entire association window. Use recent median motion.
            steps = [(b.pts_ms-a.pts_ms, b.x-a.x, b.y-a.y)
                     for a, b in zip(recent, recent[1:])]
            elapsed = min(pts_ms-last.pts_ms, 3*median(step[0] for step in steps))
            x += median(dx/dt for dt, dx, _ in steps) * elapsed
            y += median(dy/dt for dt, _, dy in steps) * elapsed
        radius = min(40.0, max(8.0, max(width, height) * 0.8))
        predictions[index] = (x, y, radius)
        grid[(math.floor(x / 40), math.floor(y / 40))].append(index)
    matches = defaultdict(list)
    reverse = defaultdict(list)
    affinities = {}
    for detection_index, detection in enumerate(detections):
        gx, gy = math.floor(detection.x / 40), math.floor(detection.y / 40)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for index in grid[(gx + dx, gy + dy)]:
                    x, y, radius = predictions[index]
                    # Most neighboring-bin entries are outside this same gate.
                    # Reject them before computing unused footprint comparisons.
                    if not math.hypot(detection.x - x, detection.y - y) <= radius:
                        continue
                    last = tracks[index].samples[-1]
                    width, height = footprints[index]
                    # Proximity alone lets a dim clothing fragment steal a phone
                    # or make it ambiguous. Require compatible footprint and
                    # brightness, without assuming either pilot's hue.
                    # A transition frame can include a wide reflected color band.
                    # Its footprint must not prevent the next clean frame from
                    # returning to the recent screen size.
                    area_ratio = detection.width * detection.height / (width * height)
                    brightness = (max(detection.rgb), max(last.rgb))
                    overlap_width = max(0, min(x + width / 2, detection.x + detection.width / 2)
                                        - max(x - width / 2, detection.x - detection.width / 2))
                    overlap_height = max(0, min(y + height / 2, detection.y + detection.height / 2)
                                         - max(y - height / 2, detection.y - detection.height / 2))
                    smaller_area = min(width * height, detection.width * detection.height)
                    if (0.35 <= area_ratio <= 4 and
                            min(brightness) >= 0.25 * max(brightness) and
                            overlap_width * overlap_height >= smaller_area * 0.2):
                        matches[detection_index].append(index)
                        reverse[index].append(detection_index)
                        overlap = overlap_width * overlap_height
                        union = width * height + detection.width * detection.height - overlap
                        affinities[index, detection_index] = overlap / union
    # A full screen can coexist with smaller reflected fragments in the gate.
    # Prefer a distinctly better footprint match, but never resolve near ties or
    # an expanded two-phone merge by distance alone.
    preferred = {}
    for index, choices in reverse.items():
        ranked = sorted(choices, key=lambda choice: affinities[index, choice], reverse=True)
        if len(ranked) < 2:
            continue
        best, second = ranked[:2]
        detection = detections[best]
        width, height = footprints[index]
        if (affinities[index, best] >= 0.65 and
                affinities[index, best] - affinities[index, second] >= 0.25 and
                detection.width * detection.height <= width * height * 1.25):
            preferred[index] = best
    reverse.clear()
    for detection_index, choices in matches.items():
        choices = [index for index in choices
                   if index not in preferred or preferred[index] == detection_index]
        if len(choices) > 1:
            ranked = sorted(choices, key=lambda index: affinities[index, detection_index], reverse=True)
            best, second = ranked[:2]
            detection = detections[detection_index]
            width, height = footprints[best]
            if (affinities[best, detection_index] >= 0.65 and
                    affinities[best, detection_index] - affinities[second, detection_index] >= 0.25 and
                    detection.width * detection.height <= width * height * 1.25):
                choices = [best]
        matches[detection_index] = choices
        for index in choices:
            reverse[index].append(detection_index)
    next_active = set(predictions)
    for detection_index, detection in enumerate(detections):
        candidates = matches[detection_index]
        if len(candidates) == 1 and len(reverse[candidates[0]]) == 1:
            index = candidates[0]
            width, height = footprints[index]
            if detection.width * detection.height > width * height * 3:
                # A sudden broad glow is missing evidence for this phone. Keep
                # its recent track alive for the next frame instead of adopting
                # the halo as a new screen footprint.
                continue
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
                for other in candidates:
                    if other != index:
                        peer = tracks[other]
                        # One-frame pieces of a color transition are not a second
                        # persistent screen. A later verified preamble still vetoes.
                        independent = (len(peer.samples) >= 3 and
                                       peer.samples[-1].pts_ms-peer.samples[0].pts_ms >= 60 and
                                       separate_footprints(tracks[index], peer))
                        tracks[index].collisions.append((pts_ms, peer.track_id, independent))
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

