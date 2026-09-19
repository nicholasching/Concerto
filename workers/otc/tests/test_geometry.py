import copy

import numpy as np
import pytest

from otc.geometry import (
    build_mappings, fit_overlap, fuse_locations, manual_mapping, reject_duplicates,
)


def camera(camera_id="a", column="left", anchors=True):
    return {"cameraId": camera_id, "primaryColumn": column, "anchors":
            [{"x": 90, "y": 90}, {"x": 10, "y": 90}, {"x": 10, "y": 10},
             {"x": 90, "y": 10}] if anchors else None}


def observation(device_id=0, camera_id="a", x=50, y=50):
    return {"deviceId": device_id, "cameraId": camera_id, "status": "accepted",
            "centerPx": {"x": x, "y": y}, "decodeScore": .95, "reasons": []}


def test_manual_mapping_preserves_audience_orientation_and_support():
    mapping = manual_mapping(camera(), 100, 100)
    assert np.allclose(mapping.project([90, 90]), [0, 0])
    assert np.allclose(mapping.project([10, 10]), [1/3, 1])
    assert np.allclose(mapping.project([50, 50]), [1/6, .5])
    assert mapping.project([0, 50]) is None


@pytest.mark.parametrize("points", [
    [(10, 10), (20, 20), (30, 30), (40, 40)],
    [(10, 10), (90, 90), (10, 90), (90, 10)],
    [(-1, 10), (90, 10), (90, 90), (10, 90)],
])
def test_bad_anchors_fail_instead_of_inventing_a_map(points):
    item = camera()
    item["anchors"] = [dict(zip(("x", "y"), p)) for p in points]
    with pytest.raises(ValueError, match="anchors"):
        manual_mapping(item, 100, 100)


def test_overlap_requires_distributed_matches_and_held_out_agreement():
    points = np.array([(x, y) for y in (20, 50, 80) for x in (20, 50, 80)], dtype=float)
    reference = manual_mapping(camera(), 100, 100)
    fitted = fit_overlap(points+3, points, (100, 100), (100, 100), reference)
    assert fitted is not None
    assert np.allclose(fitted.project([53, 53]), [1/6, .5])
    assert fitted.project([95, 95]) is None  # No extrapolation outside observed matches.
    assert fit_overlap(points[:7], points[:7], (100, 100), (100, 100), reference) is None
    narrow = points.copy()
    narrow[:, 0] = narrow[:, 0] / 10 + 40
    assert fit_overlap(narrow, narrow, (100, 100), (100, 100), reference) is None
    wrong = points.copy()
    wrong[0] += 20  # Independent holdout must detect this false correspondence.
    assert fit_overlap(points, wrong, (100, 100), (100, 100), reference) is None


def test_unanchored_camera_can_use_validated_overlap():
    cameras = [camera("a"), camera("b", anchors=False)]
    points = [(x, y) for y in (20, 50, 80) for x in (20, 50, 80)]
    observations = []
    for device_id, (x, y) in enumerate(points):
        observations += [observation(device_id, "a", x, y), observation(device_id, "b", x+3, y+3)]
    mappings = build_mappings({"cameras": cameras}, {"a": (100, 100), "b": (100, 100)}, observations)
    assert mappings["b"][0].mode == "overlap"


def test_duplicates_conflicts_and_unseen_never_get_coordinates():
    manifest = {"participantIds": [0, 1, 2], "cameras": [camera("a"), camera("b")]}
    duplicate = [observation(0), observation(0, x=20), observation(1, "a", y=20),
                 observation(1, "b", y=80)]
    blocked = reject_duplicates(duplicate)
    mappings = {c["cameraId"]: [manual_mapping(c, 100, 100)] for c in manifest["cameras"]}
    locations, warnings = fuse_locations(manifest, duplicate, mappings, blocked)
    assert [p["status"] for p in locations] == ["ambiguous", "ambiguous", "unseen"]
    assert all(p["x"] is None and p["y"] is None for p in locations)
    assert all(o["status"] == "ambiguous" for o in duplicate[:2])
    assert warnings


def test_no_geometry_is_coarse_and_cross_column_disagreement_is_ambiguous():
    manifest = {"participantIds": [0], "cameras": [camera("a", anchors=False)]}
    locations, _ = fuse_locations(manifest, [observation()], {"a": []}, set())
    assert locations[0]["status"] == "coarse"
    assert locations[0]["mappingMode"] == "optical-column"
    assert locations[0]["x"] is None
    manifest = copy.deepcopy(manifest)
    manifest["cameras"].append(camera("b", "right", False))
    locations, _ = fuse_locations(manifest, [observation(), observation(camera_id="b")],
                                  {"a": [], "b": []}, set())
    assert locations[0]["status"] == "ambiguous"
