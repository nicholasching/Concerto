"""Red/blue diagnostic qualification for the local flash-boxing monitor."""

from dataclasses import dataclass, field

import cv2
import numpy as np


@dataclass(frozen=True)
class PaletteSettings:
    """OpenCV HSV bands for the diagnostic #FF0000 / #0066FF palette."""

    red_hue: int = 0
    blue_hue: int = 108
    red_hue_tolerance: int = 5
    blue_hue_tolerance: int = 20
    # Tuned against the diagnostic auditorium clip: displayed phone colours
    # remain above ~207 while the dim pink shirt stays at or below ~155.
    saturation: int = 170
    value: int = 50


@dataclass(frozen=True)
class FlashSettings:
    value: int = 200
    max_saturation: int = 80
    minimum_rise: int = 50


DEFAULT_PALETTE_SETTINGS = PaletteSettings()
DEFAULT_FLASH_SETTINGS = FlashSettings()
SELECTED_TRACK_MAX_AGE_MS = 350
PHASE_MIN_SAMPLES = 2
PHASE_MIN_DURATION_MS = 50
PHASE_MAX_GAP_MS = 100
REQUIRED_FLASH_SEQUENCE = ("red", "blue", "red", "blue")
FRAGMENT_HANDOFF_MIN_AREA_RATIO = .5
FRAGMENT_HANDOFF_MAX_AREA_RATIO = 2.0
FRAGMENT_HANDOFF_MIN_OVERLAP = .35


@dataclass
class ColorPhase:
    """One contiguous run of exclusively owned palette evidence."""

    color: str
    started_ms: float
    last_seen_ms: float
    samples: int = 1

    @property
    def valid(self):
        return (self.samples >= PHASE_MIN_SAMPLES and
                self.last_seen_ms - self.started_ms >= PHASE_MIN_DURATION_MS)


@dataclass
class FlashSequence:
    """Confirm red -> blue -> red -> blue, never colour presence alone."""

    completed: list[ColorPhase] = field(default_factory=list)
    current: ColorPhase | None = None
    confirmed: bool = False

    def _reset_pending(self):
        self.completed.clear()
        self.current = None

    def _matches_required_sequence(self):
        if self.current is None or not self.current.valid:
            return False
        colors = [phase.color for phase in self.completed[-3:]] + [self.current.color]
        return tuple(colors) == REQUIRED_FLASH_SEQUENCE

    def observe(self, color: str, pts_ms: float) -> bool:
        """Record one frame's evidence and return the latched qualification state.

        ``mixed`` means red and blue independently matched the same screen in
        one frame. It is deliberately not treated as a transition: a static
        split-colour display must not look like a flashing phone.
        """
        if self.confirmed:
            return True
        if color not in {"red", "blue", "none", "mixed"}:
            raise ValueError("Palette evidence must be red, blue, none, or mixed")
        if color == "mixed":
            self._reset_pending()
            return False
        if color == "none":
            if self.current and pts_ms - self.current.last_seen_ms > PHASE_MAX_GAP_MS:
                self._reset_pending()
            return False
        if self.current is None:
            self.current = ColorPhase(color, pts_ms, pts_ms)
        elif color == self.current.color:
            if pts_ms - self.current.last_seen_ms > PHASE_MAX_GAP_MS:
                self._reset_pending()
                self.current = ColorPhase(color, pts_ms, pts_ms)
            else:
                self.current.last_seen_ms = pts_ms
                self.current.samples += 1
        elif pts_ms - self.current.last_seen_ms > PHASE_MAX_GAP_MS:
            self._reset_pending()
            self.current = ColorPhase(color, pts_ms, pts_ms)
        elif self.current.valid:
            self.completed = (self.completed + [self.current])[-3:]
            self.current = ColorPhase(color, pts_ms, pts_ms)
        else:
            self._reset_pending()
            self.current = ColorPhase(color, pts_ms, pts_ms)
        self.confirmed = self._matches_required_sequence()
        return self.confirmed


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
            if (FRAGMENT_HANDOFF_MIN_AREA_RATIO <= area_ratio <= FRAGMENT_HANDOFF_MAX_AREA_RATIO and
                    overlap_width * overlap_height >= min(previous.width * previous.height,
                                                          current.width * current.height) * FRAGMENT_HANDOFF_MIN_OVERLAP):
                parents.append(parent.track_id)
        if len(parents) == 1:
            links.setdefault(parents[0], []).append(child.track_id)
    handoffs = []
    for parent_id, child_ids in links.items():
        if len(child_ids) == 1:
            child_id = child_ids[0]
            qualified_track_ids.remove(parent_id)
            qualified_track_ids.add(child_id)
            handoffs.append((parent_id, child_id))
    return handoffs
