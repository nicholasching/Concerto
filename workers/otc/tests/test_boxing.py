from pathlib import Path

import numpy as np

from otc.boxing import _palette_phase_by_track, box_video
from otc.red_blue_diagnostic import (
    FlashSequence,
    carry_qualification_to_current_fragment,
    palette_masks,
)
from otc.tracking import Sample, Track, detect_screens
from otc.video import read_frames


def test_box_video_reuses_screen_tracking_and_writes_visible_boxes(capture, tmp_path):
    _path, manifest, _truth = capture(count=6, red_blue=True)
    source = Path(manifest["cameras"][0]["videoPath"])
    output = tmp_path / "boxed.mp4"

    summary = box_video(source, output)

    assert output.is_file() and output.stat().st_size > 0
    assert summary["frameCount"] == len(list(read_frames(source)))
    assert summary["trackCount"] > 0
    assert summary["qualifiedTrackCount"] > 0
    assert summary["boxesDrawn"] > 0
    # The synthetic source does not use this green; an annotated box survives
    # H.264 encoding on at least one output frame.
    assert any(
        np.count_nonzero((rgb[:, :, 1] > rgb[:, :, 0] + 45)
                         & (rgb[:, :, 1] > rgb[:, :, 2] + 45)
                         & (rgb[:, :, 1] > 130)) > 20
        for _, rgb in read_frames(output)
    )


def _observe_phase(sequence, color, started_ms):
    return any(sequence.observe(color, started_ms + offset) for offset in (0, 60, 160))


def test_flash_qualification_requires_distinct_ordered_colour_phases():
    sequence = FlashSequence()
    assert not _observe_phase(sequence, "red", 0)
    assert not _observe_phase(sequence, "blue", 200)
    assert not _observe_phase(sequence, "red", 400)
    assert _observe_phase(sequence, "blue", 600)
    # The proven phone stays confirmed when it holds blue after the packet.
    assert sequence.observe("blue", 2_000)

    one_change = FlashSequence()
    assert not _observe_phase(one_change, "red", 0)
    assert not _observe_phase(one_change, "blue", 200)

    mixed = FlashSequence()
    for pts_ms in range(0, 1_000, 60):
        assert not mixed.observe("mixed", pts_ms)

    noisy = FlashSequence()
    assert not noisy.observe("red", 0)  # One-frame noise cannot form a phase.
    assert not _observe_phase(noisy, "blue", 200)
    assert not _observe_phase(noisy, "red", 400)
    assert not _observe_phase(noisy, "blue", 600)


def test_pending_flash_sequence_does_not_cross_a_long_gap_or_fragment():
    sequence = FlashSequence()
    assert not _observe_phase(sequence, "red", 0)
    assert not sequence.observe("none", 300)
    assert not _observe_phase(sequence, "blue", 360)
    assert not _observe_phase(sequence, "red", 560)
    assert not _observe_phase(sequence, "blue", 760)

    replacement = Track("replacement", [Sample(320, 10, 10, 20, 20, (0, 102, 255))])
    qualified = Track("qualified", [Sample(300, 10, 10, 8, 12, (255, 0, 0))])
    qualified_ids = {qualified.track_id}
    carry_qualification_to_current_fragment([qualified, replacement], qualified_ids, 320)
    assert qualified_ids == {replacement.track_id}


def test_palette_evidence_is_exclusive_and_rejects_an_enclosing_ghost_track():
    rgb = np.zeros((120, 120, 3), dtype=np.uint8)
    rgb[40:60, 50:65] = (255, 0, 0)
    red, blue = palette_masks(rgb)
    tracks = [
        ("phone", Sample(0, 57, 49, 15, 20, (0, 0, 0))),
        ("nearby-fragment", Sample(0, 58, 50, 16, 20, (0, 0, 0))),
        ("large-enclosing-ghost", Sample(0, 60, 60, 100, 100, (0, 0, 0))),
    ]

    phases = _palette_phase_by_track(rgb, 0, red, blue, tracks)

    # The exact phone footprint owns the red blob. The near match cannot share
    # it, and the large candidate fails the minimum colour-coverage requirement.
    assert phases == {"phone": "red"}


def test_static_red_blue_split_is_mixed_not_a_flash_phase():
    rgb = np.zeros((120, 120, 3), dtype=np.uint8)
    rgb[40:60, 40:50] = (255, 0, 0)
    rgb[40:60, 50:60] = (0, 102, 255)
    red, blue = palette_masks(rgb)
    tracks = [("split-screen", Sample(0, 50, 49, 20, 20, (0, 0, 0)))]

    assert _palette_phase_by_track(rgb, 0, red, blue, tracks) == {"split-screen": "mixed"}


def test_dim_red_candidate_can_start_without_a_blue_core():
    rgb = np.full((90, 120, 3), 9, dtype=np.uint8)
    rgb[30:50, 45:60] = (125, 6, 5)  # Saturated red, intentionally below bright/blue-core value.

    detections = detect_screens(rgb, 0, np.zeros(rgb.shape[:2], dtype=np.uint8))

    assert any(sample.width >= 15 and sample.height >= 20 for sample in detections)
