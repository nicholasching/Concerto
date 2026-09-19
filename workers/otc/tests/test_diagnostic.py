import pytest

import numpy as np

from otc.diagnostic import (
    DEFAULT_FLASH_SETTINGS, DEFAULT_PALETTE_SETTINGS, carry_qualification_to_current_fragment, flash_seed_mask,
    palette_masks, palette_settings_from_values, settings_from_values,
)
from otc.diagnostic import track_has_both_palette_colors
from otc.tracking import DEFAULT_DETECTION_SETTINGS, DetectionSettings, Sample, Track


def test_diagnostic_slider_values_preserve_valid_odd_kernel_and_percentage():
    settings = settings_from_values({
        "opening_kernel": 4, "minimum_dimension_px": 0, "minimum_area_px": 0, "minimum_fill_ratio": 35,
    })
    assert settings.opening_kernel == 5
    assert settings.minimum_dimension_px == 1
    assert settings.minimum_area_px == 1
    assert settings.minimum_fill_ratio == .35


def test_detection_settings_reject_invalid_kernel():
    with pytest.raises(ValueError, match="positive odd"):
        DetectionSettings(opening_kernel=2)


def test_default_detection_settings_remain_the_characterized_worker_values():
    assert (DEFAULT_DETECTION_SETTINGS.bright_saturation, DEFAULT_DETECTION_SETTINGS.bright_value) == (25, 190)
    assert (DEFAULT_DETECTION_SETTINGS.dim_saturation, DEFAULT_DETECTION_SETTINGS.dim_value) == (55, 50)


def test_palette_masks_isolate_red_and_blue_but_not_white_or_an_unrelated_stage_light():
    rgb = np.zeros((20, 40, 3), np.uint8)
    rgb[:, :10] = (255, 0, 0)
    rgb[:, 10:20] = (0, 102, 255)
    rgb[:, 20:30] = (255, 255, 255)
    rgb[:, 30:] = (180, 20, 180)
    settings = settings_from_values({
        "opening_kernel": 3, "minimum_area_px": 12, "minimum_fill_ratio": 35,
    })
    palette = palette_settings_from_values({
        "red_hue_tolerance": 20, "blue_hue_tolerance": 20,
        "palette_saturation": 25, "palette_value": 50,
    })
    red, blue = palette_masks(rgb, settings, palette)
    assert red[:, :10].all()
    assert not red[:, 10:].any()
    assert blue[:, 10:20].all() and not blue[:, :10].any() and not blue[:, 20:].any()


def test_flash_seed_mask_requires_a_neutral_bright_rise():
    previous = np.zeros((10, 20), np.uint8)
    rgb = np.zeros((10, 20, 3), np.uint8)
    rgb[:, :10] = (255, 255, 255)
    rgb[:, 10:] = (0, 102, 255)
    mask, current = flash_seed_mask(rgb, previous, DEFAULT_FLASH_SETTINGS)
    assert mask[:, :10].all()
    assert not mask[:, 10:].any()
    stable_mask, _ = flash_seed_mask(rgb, current, DEFAULT_FLASH_SETTINGS)
    assert not stable_mask.any()


def test_only_tracks_that_repeatedly_show_both_palette_colors_are_promoted():
    red = Sample(0, 10, 10, 8, 12, (255, 0, 0))
    white = Sample(0, 10, 10, 8, 12, (255, 255, 255))
    blue = Sample(200, 10, 10, 8, 12, (0, 102, 255))
    later_blue = Sample(2_000, 10, 10, 8, 12, (0, 102, 255))
    red_only = Track("red", [red, red, red, red])
    both = Track("both", [red, blue, red, blue])
    white_and_blue = Track("white-and-blue", [white, blue, white, blue])
    held_blue = Track("held-blue", [red, blue, red, blue, later_blue])
    assert not track_has_both_palette_colors(red_only, DEFAULT_PALETTE_SETTINGS)
    assert track_has_both_palette_colors(both, DEFAULT_PALETTE_SETTINGS)
    assert not track_has_both_palette_colors(white_and_blue, DEFAULT_PALETTE_SETTINGS)
    assert track_has_both_palette_colors(held_blue, DEFAULT_PALETTE_SETTINGS)
    assert not track_has_both_palette_colors(both, DEFAULT_PALETTE_SETTINGS, now_ms=600)


def test_qualified_track_latch_follows_one_overlapping_current_fragment():
    red = Sample(300, 10, 10, 8, 12, (255, 0, 0))
    fragment = Sample(320, 10, 10, 20, 20, (0, 102, 255))
    qualified = Track("qualified", [red])
    replacement = Track("replacement", [fragment])
    qualified_ids = {qualified.track_id}

    carry_qualification_to_current_fragment([qualified, replacement], qualified_ids, 320)

    assert qualified_ids == {replacement.track_id}


def test_qualified_latch_is_not_transferred_to_a_separate_blob():
    qualified = Track("qualified", [Sample(300, 10, 10, 8, 12, (255, 0, 0))])
    separate = Track("separate", [Sample(320, 80, 80, 20, 20, (0, 102, 255))])
    qualified_ids = {qualified.track_id}

    carry_qualification_to_current_fragment([qualified, separate], qualified_ids, 320)

    assert qualified_ids == {qualified.track_id}
