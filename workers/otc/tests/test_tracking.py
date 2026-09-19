import numpy as np

from otc.tracking import Sample, associate, detect_screens


def screen(pts, x=30, width=10):
    return Sample(pts, x, 30, width, 16, (255, 176, 0))


def test_partial_cover_then_uncover_preserves_the_original_track():
    tracks = []
    active = associate(tracks, set(), [screen(0)], 0)
    active = associate(tracks, active, [screen(33, x=32, width=5)], 33)
    active = associate(tracks, active, [screen(66, x=32, width=5)], 66)
    associate(tracks, active, [screen(100)], 100)
    assert len(tracks) == 1
    assert not tracks[0].reasons
    assert len(tracks[0].samples) == 4


def test_merge_with_two_nearby_tracks_marks_both_ambiguous():
    tracks = []
    active = associate(tracks, set(), [screen(0, x=25), screen(0, x=35)], 0)
    associate(tracks, active, [screen(33, x=30, width=20)], 33)
    assert len(tracks) == 2
    assert all("ambiguous screen association or merge" in track.reasons for track in tracks)


def test_long_occlusion_starts_a_new_track_instead_of_guessing_identity():
    tracks = []
    active = associate(tracks, set(), [screen(0)], 0)
    associate(tracks, active, [screen(400)], 400)
    assert len(tracks) == 2


def test_screen_hole_and_nested_island_keep_separate_colors_and_centers():
    rgb = np.zeros((100, 100, 3), dtype=np.uint8)
    rgb[10:50, 10:50] = (255, 176, 0)
    rgb[20:40, 20:40] = 0
    rgb[24:36, 24:36] = (0, 100, 255)
    found = detect_screens(rgb, 10, np.zeros((100, 100), np.uint8))
    assert len(found) == 2
    assert {(p.width, p.height, p.rgb) for p in found} == {
        (40, 40, (255., 176., 0.)), (12, 12, (0., 100., 255.)),
    }
    assert all(p.x == 29.5 and p.y == 29.5 for p in found)
    excluded = np.zeros((100, 100), np.uint8)
    excluded[10:50, 10:50] = 255
    assert detect_screens(rgb, 10, excluded) == []
