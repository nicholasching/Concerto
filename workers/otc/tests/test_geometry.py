import copy

import numpy as np
import pytest

from otc.geometry import (
    Mapping, build_mappings, fit_overlap, fuse_locations, manual_mapping, reject_duplicates,
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


@pytest.mark.parametrize("camera_count", [1, 2, 3])
def test_stage_facing_seating_coordinates_work_with_each_available_camera(camera_count):
    cameras = [camera(f"view-{index}", column)
               for index, column in enumerate(("left", "center", "right")[:camera_count])]
    # Same four-anchor order used by the stage-facing UI. Near seats are at image-bottom,
    # and audience-left is image-right. Each camera maps its column independently.
    observations = [observation(index * 2, item["cameraId"], 70, 70)
                    for index, item in enumerate(cameras)]
    observations += [observation(index * 2 + 1, item["cameraId"], 30, 30)
                     for index, item in enumerate(cameras)]
    manifest = {"cameras": cameras, "participantIds": list(range(camera_count * 2))}
    mappings = build_mappings(manifest, {item["cameraId"]: (100, 100) for item in cameras}, observations)
    locations, warnings = fuse_locations(manifest, observations, mappings, set())
    assert not warnings
    assert len(locations) == camera_count * 2
    for index in range(camera_count):
        near, far = locations[index * 2:index * 2 + 2]
        assert near["status"] == far["status"] == "localized"
        assert near["column"] == far["column"] == cameras[index]["primaryColumn"]
        assert near["x"] < far["x"]
        assert np.allclose([near["y"], far["y"]], [.25, .75])


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


def test_overlap_cannot_hide_conflicting_primary_column_anchors():
    cameras = [camera("a", "left"), camera("b", "right")]
    points = [(x, y) for y in (20, 50, 80) for x in (20, 50, 80)]
    observations = [observation(device_id, item["cameraId"], x, y)
                    for device_id, (x, y) in enumerate(points) for item in cameras]
    manifest = {"cameras": cameras, "participantIds": list(range(len(points)))}
    mappings = build_mappings(manifest, {"a": (100, 100), "b": (100, 100)}, observations)
    locations, warnings = fuse_locations(manifest, observations, mappings, set())
    # Perfect image correspondences do not resolve contradictory operator anchors.
    # Overlap must not overwrite both primary ROIs into apparent agreement.
    assert all(location["status"] == "ambiguous" for location in locations)
    assert all(location["x"] is None and location["y"] is None for location in locations)
    assert len(warnings) == len(points)


def test_overlap_extends_coverage_outside_primary_roi():
    cameras = [camera("a", "left"), camera("b", "center")]
    cameras[1]["anchors"] = [{"x": 90, "y": 90}, {"x": 50, "y": 90},
                             {"x": 50, "y": 10}, {"x": 90, "y": 10}]
    points = [(x, y) for y in (20, 50, 80) for x in (20, 30, 40)]
    observations = [observation(device_id, item["cameraId"], x, y)
                    for device_id, (x, y) in enumerate(points) for item in cameras]
    observations.append(observation(9, "b", 70, 50))
    manifest = {"cameras": cameras, "participantIds": list(range(10))}
    mappings = build_mappings(manifest, {"a": (100, 100), "b": (100, 100)}, observations)
    assert [mapping.mode for mapping in mappings["b"]] == ["manual-anchors", "overlap"]
    # B also sees A's column outside its own anchors; it may map that shared hull.
    assert mappings["b"][0].project([30, 50]) is None
    assert np.allclose(mappings["b"][1].project([30, 50]), [.25, .5])
    locations, warnings = fuse_locations(manifest, observations, mappings, set())
    assert all(location["status"] == "localized" for location in locations)
    assert locations[4]["column"] == "left"
    assert locations[9]["column"] == "center"
    assert not warnings


def test_agreeing_views_prefer_primary_roi_before_decode_score():
    cameras = [camera("a", "left"), camera("b", "center", anchors=False)]
    primary = manual_mapping(cameras[0], 100, 100)
    matrix = primary.matrix.copy()
    matrix[1, 2] += .02
    secondary = Mapping(matrix, primary.support, "overlap", 1.0)
    observations = [observation(0, "a"), observation(0, "b")]
    observations[0]["decodeScore"] = .9
    observations[1]["decodeScore"] = 1.0
    manifest = {"cameras": cameras, "participantIds": [0]}
    mappings = {"a": [primary], "b": [secondary]}
    locations, warnings = fuse_locations(manifest, observations, mappings, set())
    assert locations[0]["status"] == "localized"
    assert locations[0]["mappingMode"] == "manual-anchors"
    assert np.allclose([locations[0]["x"], locations[0]["y"]], [1/6, .5])
    assert locations[0]["sourceCameraIds"] == ["a", "b"]
    assert not warnings


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


@pytest.mark.parametrize("camera_count", [1, 2, 3])
def test_declared_frame_layout_maps_every_available_view_without_anchors(camera_count):
    cameras = [{**camera(str(i), column, anchors=False), "frameLayout": "from-stage"}
               for i, column in enumerate(("left", "center", "right")[:camera_count])]
    observations = [observation(i, c["cameraId"], 75, 150) for i, c in enumerate(cameras)]
    manifest = {"cameras": cameras, "participantIds": list(range(camera_count))}
    mappings = build_mappings(manifest, {c["cameraId"]: (101, 201) for c in cameras}, observations)
    locations, warnings = fuse_locations(manifest, observations, mappings, set())
    assert not warnings
    for i, location in enumerate(locations):
        assert location["status"] == "localized" and location["mappingMode"] == "frame-layout"
        assert np.allclose([location["x"], location["y"]], [(i+.25)/3, .25])
        assert location["column"] == cameras[i]["primaryColumn"]


def test_frame_orientation_is_explicit_and_manual_corners_take_precedence():
    item = {**camera(anchors=False), "frameLayout": "from-back"}
    mapping = manual_mapping(item, 201, 101)
    assert np.allclose(mapping.project([150, 25]), [.25, .25])
    assert mapping.mode == "frame-layout"
    assert manual_mapping(camera(anchors=False), 201, 101) is None
    item["anchors"] = camera()["anchors"]
    mapping = manual_mapping(item, 201, 101)
    assert mapping.mode == "manual-anchors"
    assert np.allclose(mapping.project([90, 90]), [0, 0])


def test_approximate_frame_cannot_seed_overlap_registration():
    cameras = [{**camera("a", anchors=False), "frameLayout": "from-stage"},
               camera("b", anchors=False)]
    points = [(x, y) for y in (20, 50, 80) for x in (20, 50, 80)]
    observations = [observation(i, item["cameraId"], x, y)
                    for i, (x, y) in enumerate(points) for item in cameras]
    mappings = build_mappings({"cameras": cameras}, {"a": (100, 100), "b": (100, 100)}, observations)
    assert mappings["a"][0].mode == "frame-layout" and mappings["b"] == []
