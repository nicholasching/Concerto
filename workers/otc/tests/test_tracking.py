import numpy as np
import pytest

from otc.tracking import Sample, Track, associate, detect_screens, retire_fragments, scan_camera


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


def test_retirement_preserves_active_and_potentially_decodable_tracks_and_reasons():
    short = Track("screen-0", [screen(0)])
    active_track = Track("screen-1", [screen(700)])
    decodable = Track("screen-2", [screen(i) for i in range(40)], {"ambiguous screen association or merge"})
    tracks = [short, active_track, decodable]
    active, removed = retire_fragments(tracks, {0, 1}, 1000)
    assert removed == 1
    assert tracks == [active_track, decodable]
    assert active == {0}
    assert decodable.reasons == {"ambiguous screen association or merge"}
    # A new unrelated track must not reuse the retained screen-2 ID after compaction.
    associate(tracks, active, [screen(1000, x=1000)], 1000, removed)
    assert tracks[-1].track_id == "screen-3"
    # The 350 ms association window stays inclusive, exactly as before.
    active, removed = retire_fragments(tracks, {0, 2}, 1050)
    assert removed == 0


def test_scene_with_over_8192_short_fragments_keeps_the_continuous_phone(monkeypatch):
    # A textured/moving background continually creates fragments. None can supply
    # the 40 samples required by the decoder; a real continuous screen stays intact.
    rgb = np.zeros((100, 100, 3), np.uint8)
    monkeypatch.setattr("otc.tracking.read_frames", lambda *_: ((i * 33, rgb) for i in range(450)))

    def detections(_rgb, pts, _excluded):
        frame = pts // 33
        noise = [screen(pts, x=1000 + (frame * 20 + index) * 100) for index in range(20)]
        return [screen(pts)] + noise

    monkeypatch.setattr("otc.tracking.detect_screens", detections)
    scan = scan_camera(None, {"rotationDegrees": 0, "exclusionRois": []})
    phone = scan.tracks[0]
    assert phone.track_id == "screen-0"
    assert len(phone.samples) == 450
    assert not phone.reasons
    assert scan.discarded_fragments > 8192
    assert len(scan.tracks) < 250
    assert len({track.track_id for track in scan.tracks}) == len(scan.tracks)


def test_retained_track_resource_limit_still_refuses_an_overloaded_scene():
    tracks = [Track(f"screen-{i}", [screen(0)]) for i in range(8192)]
    with pytest.raises(ValueError, match="Too many screen tracks"):
        associate(tracks, set(), [screen(1000, x=1000)], 1000)
