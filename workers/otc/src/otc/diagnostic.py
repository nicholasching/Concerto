"""Local webcam detector monitor; it never emits an optical identity or map."""

import base64
from dataclasses import dataclass, replace
import time

import cv2
import numpy as np

from .tracking import (
    DEFAULT_DETECTION_SETTINGS, Track, associate, detect_screens, retire_fragments,
)


SLIDERS = (
    ("Yellow hue tolerance", "yellow_hue_tolerance", 45),
    ("Blue hue tolerance", "blue_hue_tolerance", 45),
    ("Palette saturation", "palette_saturation", 255),
    ("Palette brightness", "palette_value", 255),
    ("Flash brightness", "flash_value", 255),
    ("Flash max saturation", "flash_max_saturation", 255),
    ("Flash minimum rise", "flash_minimum_rise", 255),
    ("Opening kernel", "opening_kernel", 15),
    ("Minimum blob width/height", "minimum_dimension_px", 50),
    ("Minimum area", "minimum_area_px", 200),
    ("Minimum fill %", "minimum_fill_ratio", 100),
)


@dataclass(frozen=True)
class PaletteSettings:
    """OpenCV HSV hue bands for the default amber/blue calibration palette."""

    yellow_hue: int = 21  # #ffb000
    blue_hue: int = 108  # #0066ff
    yellow_hue_tolerance: int = 20
    blue_hue_tolerance: int = 20
    palette_saturation: int = 55
    palette_value: int = 50


DEFAULT_PALETTE_SETTINGS = PaletteSettings()


@dataclass(frozen=True)
class FlashSettings:
    flash_value: int = 200
    flash_max_saturation: int = 80
    flash_minimum_rise: int = 50


DEFAULT_FLASH_SETTINGS = FlashSettings()
MIN_PALETTE_SAMPLES_PER_COLOR = 2
SELECTED_TRACK_MAX_AGE_MS = 350


def settings_from_values(values):
    """Build valid settings from UI slider values (fill is stored as a percentage)."""
    data = {field: value for field, value in values.items()
            if field in DEFAULT_DETECTION_SETTINGS.__dataclass_fields__}
    data["opening_kernel"] = max(1, data["opening_kernel"] | 1)
    data["minimum_dimension_px"] = max(1, data.get("minimum_dimension_px", DEFAULT_DETECTION_SETTINGS.minimum_dimension_px))
    data["minimum_area_px"] = max(1, data["minimum_area_px"])
    data["minimum_fill_ratio"] = max(1, data["minimum_fill_ratio"]) / 100
    return replace(DEFAULT_DETECTION_SETTINGS, **data)


def palette_settings_from_values(values):
    return replace(
        DEFAULT_PALETTE_SETTINGS,
        **{field: value for field, value in values.items()
           if field in DEFAULT_PALETTE_SETTINGS.__dataclass_fields__},
    )


def flash_settings_from_values(values):
    return replace(
        DEFAULT_FLASH_SETTINGS,
        **{field: value for field, value in values.items()
           if field in DEFAULT_FLASH_SETTINGS.__dataclass_fields__},
    )


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


def palette_masks(rgb, detection, palette):
    """Masks only the amber and blue calibration colors, rather than all hues."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    saturation, value = palette.palette_saturation, palette.palette_value
    yellow = _hue_band(hsv, palette.yellow_hue, palette.yellow_hue_tolerance, saturation, value)
    blue = _hue_band(hsv, palette.blue_hue, palette.blue_hue_tolerance, saturation, value)
    kernel = np.ones((detection.opening_kernel, detection.opening_kernel), np.uint8)
    return (cv2.morphologyEx(yellow, cv2.MORPH_OPEN, kernel),
            cv2.morphologyEx(blue, cv2.MORPH_OPEN, kernel))


def track_has_both_palette_colors(track: Track, palette: PaletteSettings, now_ms=None) -> bool:
    """Latch repeated amber/blue evidence while the same visual track remains visible."""
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
        return ((distance <= tolerance) & (hsv[:, 1] >= palette.palette_saturation) &
                (hsv[:, 2] >= palette.palette_value))

    return (np.count_nonzero(matches(palette.yellow_hue, palette.yellow_hue_tolerance)) >=
            MIN_PALETTE_SAMPLES_PER_COLOR and
            np.count_nonzero(matches(palette.blue_hue, palette.blue_hue_tolerance)) >=
            MIN_PALETTE_SAMPLES_PER_COLOR)


def flash_seed_mask(rgb, previous_value, settings):
    """Find a neutral bright rise: a seed, never an optical identity."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    value = hsv[:, :, 2]
    rise = np.zeros_like(value) if previous_value is None else cv2.subtract(value, previous_value)
    mask = np.where(
        (value >= settings.flash_value) &
        (hsv[:, :, 1] <= settings.flash_max_saturation) &
        (rise >= settings.flash_minimum_rise), 255, 0,
    ).astype(np.uint8)
    return mask, value


def _panel(image, label, width=480, height=270):
    view = cv2.resize(image, (width, height), interpolation=cv2.INTER_NEAREST)
    cv2.putText(view, label, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, .75, (255, 255, 255), 2)
    return view


def run_camera(camera_index):
    """Open a Tk window containing the live feed, masks, and safe candidate sliders."""
    try:
        import tkinter as tk
    except ImportError as error:  # pragma: no cover - depends on local Python build
        raise RuntimeError("Camera monitor requires Python's Tk GUI support") from error

    camera = cv2.VideoCapture(camera_index)
    if not camera.isOpened():
        raise ValueError(f"Could not open camera {camera_index}")
    root = tk.Tk()
    root.title("Audience Orchestra — detector monitor (candidate evidence only)")
    image_label = tk.Label(root)
    image_label.pack()
    controls = tk.Toplevel(root)
    controls.title("Detector settings — apply immediately")
    settings_label = tk.Label(controls, anchor="w")
    settings_label.grid(row=0, column=0, columnspan=4, sticky="ew")
    slider_values = {}
    live = {"revision": 0, "settings": None}

    def apply_settings(_value=None):
        values = {field: variable.get() for field, variable in slider_values.items()}
        settings = settings_from_values(values)
        palette_settings = palette_settings_from_values(values)
        flash_settings = flash_settings_from_values(values)
        live["settings"] = (settings, palette_settings, flash_settings)
        live["revision"] += 1
        settings_label.configure(text=(
            f"Applied now — yellow ±{palette_settings.yellow_hue_tolerance}, "
            f"blue ±{palette_settings.blue_hue_tolerance}; "
            f"palette S/V {palette_settings.palette_saturation}/{palette_settings.palette_value}; "
            f"flash V/S/rise {flash_settings.flash_value}/{flash_settings.flash_max_saturation}/"
            f"{flash_settings.flash_minimum_rise}; minimum size {settings.minimum_dimension_px}px, "
            f"area {settings.minimum_area_px}px"
        ))

    for index, (label, field, maximum) in enumerate(SLIDERS):
        source = (DEFAULT_DETECTION_SETTINGS if field in DEFAULT_DETECTION_SETTINGS.__dataclass_fields__
                  else DEFAULT_PALETTE_SETTINGS if field in DEFAULT_PALETTE_SETTINGS.__dataclass_fields__
                  else DEFAULT_FLASH_SETTINGS)
        initial = round(getattr(source, field) * (100 if field == "minimum_fill_ratio" else 1))
        variable = tk.IntVar(value=initial)
        slider = tk.Scale(controls, label=label, from_=0, to=maximum, orient="horizontal", length=170,
                          variable=variable, command=apply_settings)
        slider.grid(row=1 + index // 4, column=index % 4, sticky="ew")
        slider_values[field] = variable
    apply_settings()
    note = tk.Label(root, text="Yellow = candidate, cyan = track. This window never decodes IDs; close it to stop.")
    note.pack()
    tracks, active, applied_revision, previous_value, discarded = [], set(), -1, None, 0

    def close():
        camera.release()
        root.destroy()

    def update():
        nonlocal tracks, active, applied_revision, previous_value, discarded
        if not root.winfo_exists():
            return
        ok, frame = camera.read()
        if not ok:
            note.configure(text="Camera frame unavailable; reconnect camera or close this window.")
            root.after(250, update)
            return
        settings, palette_settings, flash_settings = live["settings"]
        if live["revision"] != applied_revision:
            tracks, active, previous_value, discarded = [], set(), None, 0
            applied_revision = live["revision"]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        excluded = np.zeros(rgb.shape[:2], np.uint8)
        yellow, blue = palette_masks(rgb, settings, palette_settings)
        palette = cv2.bitwise_or(yellow, blue)
        flash, previous_value = flash_seed_mask(rgb, previous_value, flash_settings)
        now_ms = time.monotonic() * 1000
        flash_detections = detect_screens(rgb, now_ms, excluded, settings,
                                          masks=(flash, np.zeros_like(flash)))
        palette_detections = detect_screens(rgb, now_ms, excluded, settings,
                                            masks=(palette, np.zeros_like(palette)))
        detections = flash_detections + palette_detections
        active, removed = retire_fragments(tracks, active, now_ms)
        discarded += removed
        active = associate(tracks, active, detections, now_ms, discarded)
        overlay = cv2.convertScaleAbs(frame, alpha=.25)
        overlay[palette != 0] = frame[palette != 0]
        for candidate in flash_detections:
            x = round(candidate.x - candidate.width / 2)
            y = round(candidate.y - candidate.height / 2)
            cv2.rectangle(overlay, (x, y), (x + candidate.width, y + candidate.height), (255, 0, 255), 2)
        qualified_tracks = [track for track in tracks if track_has_both_palette_colors(track, palette_settings, now_ms)]
        for track in qualified_tracks:
            sample = track.samples[-1]
            x = round(sample.x - sample.width / 2)
            y = round(sample.y - sample.height / 2)
            cv2.rectangle(overlay, (x, y), (x + sample.width, y + sample.height), (0, 220, 0), 2)
            cv2.putText(overlay, "blue + yellow", (x, max(14, y - 5)), cv2.FONT_HERSHEY_SIMPLEX,
                        .4, (0, 220, 0), 1)
        for track in tracks:
            sample = track.samples[-1]
            cv2.circle(overlay, (round(sample.x), round(sample.y)), 3, (255, 255, 0), -1)
        panels = [_panel(overlay, f"Flash seeds: {len(flash_detections)}   Palette candidates: {len(palette_detections)}   Qualified blue + yellow: {len(qualified_tracks)}", 960, 540)]
        for mask, label in ((yellow, "Yellow palette mask"), (blue, "Blue palette mask")):
            panels.append(_panel(cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR), label))
        composite = np.vstack((panels[0], np.hstack(panels[1:])))
        encoded = cv2.imencode(".png", composite)[1]
        photo = tk.PhotoImage(data=base64.b64encode(encoded).decode("ascii"))
        image_label.configure(image=photo)
        image_label.image = photo
        root.after(30, update)

    root.protocol("WM_DELETE_WINDOW", close)
    update()
    root.mainloop()
