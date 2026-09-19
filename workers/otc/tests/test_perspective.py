import math

import pytest

from otc.pipeline import process_manifest


@pytest.mark.parametrize("case,count,width,height", [
    ("perspective", 60, 640, 360), ("perspective-undersized", 60, 640, 360),
    ("perspective", 90, 1280, 720),
])
def test_perspective_mp4_sizes_and_positions_across_depth(capture, case, count, width, height):
    path, manifest, truth = capture(case, count=count, width=width, height=height)
    phones = {phone["deviceId"]: phone for phone in truth["phones"]}
    near = [phone for phone in phones.values() if phone["depth"] < 1/3]
    back = [phone for phone in phones.values() if phone["depth"] > 2/3]
    assert near and back
    assert max(p["cameraScreens"][0]["widthPx"] for p in near) > 2 * min(
        p["cameraScreens"][0]["widthPx"] for p in back
    )

    # Rear rows converge horizontally and vertically in an actual projective view.
    row_points = sorted({(p["depth"], p["cameraScreens"][0]["centerPx"]["y"])
                         for p in phones.values()})
    row_gaps = [a[1]-b[1] for a, b in zip(row_points, row_points[1:])]
    assert row_gaps[0] > 2 * row_gaps[-1]
    row_spans = []
    for depth in (row_points[0][0], row_points[-1][0]):
        xs = [p["cameraScreens"][0]["centerPx"]["x"] for p in phones.values()
              if p["depth"] == depth]
        row_spans.append(max(xs)-min(xs))
    assert row_spans[0] > 2 * row_spans[-1]
    if case == "perspective":
        assert min(p["cameraScreens"][0]["widthPx"] for p in back) == 6 * (height // 360)

    result = process_manifest(manifest, path, "synthetic")
    localized_depths = set()
    for point in result["locations"]:
        expected = phones[point["deviceId"]]
        if expected["expectedUnresolvable"]:
            assert point["status"] == "unseen"
            assert point["x"] is None and point["y"] is None
        else:
            assert point["status"] == "localized", point
            assert point["column"] == expected["column"]
            assert math.hypot(point["x"]-expected["x"], point["y"]-expected["y"]) < .015
            localized_depths.add(min(2, int(expected["depth"]*3)))
    assert localized_depths == {0, 1, 2}
    assert_accepted_observations_match_truth(result, phones)


def test_crowded_low_resolution_back_rows_keep_uncertain_positions_unknown(capture):
    path, manifest, truth = capture("perspective", count=90, width=640, height=360)
    phones = {phone["deviceId"]: phone for phone in truth["phones"]}
    result = process_manifest(manifest, path, "synthetic")
    unknown = []
    for point in result["locations"]:
        expected = phones[point["deviceId"]]
        if point["status"] == "localized":
            assert point["column"] == expected["column"]
            assert math.hypot(point["x"]-expected["x"], point["y"]-expected["y"]) < .015
        else:
            unknown.append(point)
            assert expected["depth"] > 2/3
            assert point["status"] in ("ambiguous", "unseen")
            assert point["x"] is None and point["y"] is None
    assert unknown  # Keep the demonstrated low-resolution crowding limit visible.
    assert any("ambiguous screen association or merge" in o["reasons"]
               for o in result["observations"])
    assert_accepted_observations_match_truth(result, phones)


def assert_accepted_observations_match_truth(result, phones):

    # Do not hide an incorrect accepted ID behind a later geometry rejection.
    for observation in result["observations"]:
        if observation["status"] != "accepted":
            continue
        expected = phones[observation["deviceId"]]
        assert not expected["expectedUnresolvable"]
        screen = next(s for s in expected["cameraScreens"]
                      if s["cameraId"] == observation["cameraId"])
        assert screen["visible"]
        assert math.hypot(observation["centerPx"]["x"]-screen["centerPx"]["x"],
                          observation["centerPx"]["y"]-screen["centerPx"]["y"]) < 2
