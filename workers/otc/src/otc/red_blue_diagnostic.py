"""Red/blue diagnostic qualification ported from the fix-detection monitor."""

from dataclasses import dataclass

import cv2
import numpy as np

from .tracking import Track


@dataclass(frozen=True)
class PaletteSettings:
    """OpenCV HSV bands for the diagnostic #FF0000 / #0066FF palette."""

    red_hue: int = 0
    blue_hue: int = 108
    red_hue_tolerance: int = 5
    blue_hue_tolerance: int = 20
    saturation: int = 55
    value: int = 50


@dataclass(frozen=True)
class FlashSettings:
    value: int = 200
    max_saturation: int = 80
    minimum_rise: int = 50


DEFAULT_PALETTE_SETTINGS = PaletteSettings()
DEFAULT_FLASH_SETTINGS = FlashSettings()
MIN_PALETTE_SAMPLES_PER_COLOR = 2
SELECTED_TRACK_MAX_AGE_MS = 350


def _hue_band(hsv, center, tolerance, saturation, value):
    low, high = center - tolerance, center + tolerance
    lower = (max(0, low), saturation, value)
    upper = (min(179, high), 255, 255)
    if low >= 0 and high <= 179:
        return cv2.inRange(hsv, lower, upper)
    first = cv2.inRange(hsv, lower, upper)
    if low < 0:
        return cv2.bitwise_or(first, cv2.inRange(hsv, (180 + low, saturation, value), (179, 255, 255)))
    return cv2.bitwise_or(first, cv2.inRange(hsv, (0, saturation, value), (high - 180, 255, 255)))


def palette_masks(rgb, *, opening_kernel=3, settings=DEFAULT_PALETTE_SETTINGS):
    """Return red and blue masks with the monitor's default morphology."""
    if opening_kernel < 1 or opening_kernel % 2 == 0:
        raise ValueError("opening_kernel must be a positive odd integer")
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    kernel = np.ones((opening_kernel, opening_kernel), np.uint8)
    red = _hue_band(hsv, settings.red_hue, settings.red_hue_tolerance,
                    settings.saturation, settings.value)
    blue = _hue_band(hsv, settings.blue_hue, settings.blue_hue_tolerance,
                     settings.saturation, settings.value)
    return (cv2.morphologyEx(red, cv2.MORPH_OPEN, kernel),
            cv2.morphologyEx(blue, cv2.MORPH_OPEN, kernel))


def flash_seed_mask(rgb, previous_value, settings=DEFAULT_FLASH_SETTINGS):
    """Find a neutral bright rise: a candidate seed, never an optical identity."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    value = hsv[:, :, 2]
    rise = np.zeros_like(value) if previous_value is None else cv2.subtract(value, previous_value)
    mask = np.where(
        (value >= settings.value) &
        (hsv[:, :, 1] <= settings.max_saturation) &
        (rise >= settings.minimum_rise), 255, 0,
    ).astype(np.uint8)
    return mask, value


def track_has_both_palette_colors(track: Track, settings=DEFAULT_PALETTE_SETTINGS, now_ms=None) -> bool:
    """Latch after two red and two blue samples while the same track stays visible."""
    now_ms = track.samples[-1].pts_ms if now_ms is None else now_ms
    if now_ms - track.samples[-1].pts_ms > SELECTED_TRACK_MAX_AGE_MS:
        return False
    colors = np.asarray([sample.rgb for sample in track.samples], dtype=np.uint8)
    if len(colors) < MIN_PALETTE_SAMPLES_PER_COLOR * 2:
        return False
    hsv = cv2.cvtColor(colors.reshape(-1, 1, 3), cv2.COLOR_RGB2HSV).reshape(-1, 3)

    def matches(center, tolerance):
        hue = hsv[:, 0].astype(np.int16)
        distance = np.minimum((hue - center) % 180, (center - hue) % 180)
        return ((distance <= tolerance) & (hsv[:, 1] >= settings.saturation) &
                (hsv[:, 2] >= settings.value))

    return (np.count_nonzero(matches(settings.red_hue, settings.red_hue_tolerance)) >=
            MIN_PALETTE_SAMPLES_PER_COLOR and
            np.count_nonzero(matches(settings.blue_hue, settings.blue_hue_tolerance)) >=
            MIN_PALETTE_SAMPLES_PER_COLOR)


def carry_qualification_to_current_fragment(tracks, qualified_track_ids, now_ms):
    """Carry a monitor-only latch across exactly one overlapping current fragment."""
    visible_ids = {
        track.track_id for track in tracks
        if now_ms - track.samples[-1].pts_ms <= SELECTED_TRACK_MAX_AGE_MS
    }
    qualified_track_ids.intersection_update(visible_ids)
    links = {}
    for child in tracks:
        current = child.samples[-1]
        if child.track_id in qualified_track_ids or current.pts_ms != now_ms:
            continue
        parents = []
        for parent in tracks:
            previous = parent.samples[-1]
            if parent.track_id not in qualified_track_ids or parent.track_id == child.track_id:
                continue
            area_ratio = current.width * current.height / (previous.width * previous.height)
            overlap_width = max(0, min(previous.x + previous.width / 2, current.x + current.width / 2)
                                - max(previous.x - previous.width / 2, current.x - current.width / 2))
            overlap_height = max(0, min(previous.y + previous.height / 2, current.y + current.height / 2)
                                 - max(previous.y - previous.height / 2, current.y - current.height / 2))
            if (.2 <= area_ratio <= 6 and
                    overlap_width * overlap_height >= min(previous.width * previous.height,
                                                          current.width * current.height) * .1):
                parents.append(parent.track_id)
        if len(parents) == 1:
            links.setdefault(parents[0], []).append(child.track_id)
    for parent_id, child_ids in links.items():
        if len(child_ids) == 1:
            qualified_track_ids.remove(parent_id)
            qualified_track_ids.add(child_ids[0])
