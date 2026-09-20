from pathlib import Path

import numpy as np

from otc.boxing import _palette_evidence_by_track, box_video
from otc.red_blue_diagnostic import (
    DEFAULT_PALETTE_SETTINGS,
    carry_qualification_to_current_fragment,
    palette_masks,
    track_has_both_palette_colors,
)
from otc.tracking import Sample, Track
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


def test_red_blue_qualification_requires_both_colors_and_follows_one_fragment():
    red = Sample(0, 10, 10, 8, 12, (255, 0, 0))
    blue = Sample(200, 10, 10, 8, 12, (0, 102, 255))
    red_only = Track("red", [red, red, red, red])
    both = Track("both", [red, blue, red, blue])
    held_blue = Track("held-blue", [red, blue, red, blue,
                                     Sample(2_000, 10, 10, 8, 12, (0, 102, 255))])
    assert not track_has_both_palette_colors(red_only, DEFAULT_PALETTE_SETTINGS)
    assert track_has_both_palette_colors(both, DEFAULT_PALETTE_SETTINGS)
    assert track_has_both_palette_colors(held_blue, DEFAULT_PALETTE_SETTINGS)
    assert not track_has_both_palette_colors(both, DEFAULT_PALETTE_SETTINGS, now_ms=600)

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

    evidence = _palette_evidence_by_track(rgb, 0, red, blue, tracks)

    # The exact phone footprint owns the red blob. The near match cannot share
    # it, and the large candidate fails the minimum colour-coverage requirement.
    assert set(evidence) == {"phone"}
    assert evidence["phone"].rgb == (255.0, 0.0, 0.0)
