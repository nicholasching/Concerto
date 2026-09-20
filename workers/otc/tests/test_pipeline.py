import copy
import json
import math
from pathlib import Path
import subprocess
import sys

import numpy as np
import pytest

from otc.pipeline import process_manifest
from otc.validation import validate_result, validate_schema
from otc.video import read_frames


def assert_positions(result, truth, required=None):
    ground = {p["deviceId"]: p for p in truth["phones"]}
    localized = {p["deviceId"]: p for p in result["locations"] if p["status"] == "localized"}
    if required is not None:
        assert set(localized) == set(required)
    for device_id, point in localized.items():
        expected = ground[device_id]
        assert point["column"] == expected["column"]
        assert math.hypot(point["x"]-expected["x"], point["y"]-expected["y"]) < .015
    return localized


@pytest.mark.parametrize("case,fps", [("clean",24), ("clean",60), ("missing-pilots",30),
                                     ("repeat-erasures",30), ("red-glow",30),
                                     ("emissive-background",30), ("faint-colors",30)])
def test_v2_real_video_recovery_and_correct_positions(capture, case, fps):
    path, manifest, truth = capture(case, count=6, fps=fps, v2=True)
    result = process_manifest(manifest, path, "synthetic", cpu_budget=3)
    validate_result(manifest, result)
    assert_positions(result, truth, manifest["participantIds"])
    assert any("no optical run tag" in warning for warning in result["warnings"])
    if case == "repeat-erasures":
        assert any("joint bounded repeat recovery" in o["reasons"] for o in result["observations"])


@pytest.mark.parametrize("case", ["empty", "duplicates", "crossing"])
def test_v2_retains_negative_scene_checks(capture, case):
    path, manifest, _ = capture(case, count=6, v2=True)
    result = process_manifest(manifest, path, "synthetic", cpu_budget=3)
    if case == "empty":
        assert not any(o["status"] == "accepted" for o in result["observations"])
    else:
        assert result["locations"][0]["status"] != "localized"


@pytest.mark.parametrize("fps", [24, 30, 60])
def test_red_blue_three_camera_mp4_decodes_ids_and_positions(capture, fps):
    path, manifest, truth = capture(count=6, fps=fps, red_blue=True)
    # Inspect encoded pixels independently: a red manifest must not conceal the
    # generator's former hard-coded amber emission.
    for pts, rgb in read_frames(Path(manifest["cameras"][0]["videoPath"])):
        if pts >= truth["cameraPhasePtsMs"][0] + 500:
            assert np.count_nonzero((rgb[:, :, 0] > 200) & (rgb[:, :, 1] < 40) & (rgb[:, :, 2] < 40)) > 30
            break
    else:
        pytest.fail("Video never reached the red pilot")
    result = process_manifest(manifest, path, "synthetic")
    validate_result(manifest, result)
    assert_positions(result, truth, manifest["participantIds"])
    assert not any("Ignored" in message
                   for camera in result["cameras"] for message in camera["messages"])


@pytest.mark.parametrize("case", ["emissive-background", "reflected-motion"])
def test_red_blue_washed_dim_and_reflected_screens(capture, case):
    path, manifest, truth = capture(case, count=6, red_blue=True)
    result = process_manifest(manifest, path, "synthetic")
    assert_positions(result, truth, manifest["participantIds"])


def test_red_blue_wrong_run_stays_rejected(capture):
    path, manifest, _ = capture("wrong-tag", count=6, red_blue=True)
    result = process_manifest(manifest, path, "synthetic")
    assert not any(o["status"] == "accepted" for o in result["observations"])
    assert all(p["status"] == "unseen" for p in result["locations"])


def test_actual_three_camera_mp4_roundtrip_and_review_artifacts(capture, tmp_path):
    path, manifest, truth = capture(count=30)
    events = []
    result = process_manifest(manifest, path, "synthetic", debug_dir=tmp_path / "debug",
                              job_id="job-test", progress=events.append)
    validate_result(manifest, result)
    assert_positions(result, truth, manifest["participantIds"])
    assert result["evidence"] == "synthetic"
    for camera, expected_phase in zip(result["cameras"], truth["cameraPhasePtsMs"]):
        assert abs(camera["phasePtsMs"]-expected_phase) < 40
    assert all(not (o["centerPx"]["x"] < 40 and o["centerPx"]["y"] < 20)
               for o in result["observations"])  # Stage light is not a device track.
    assert not any("Ignored" in message
                   for camera in result["cameras"] for message in camera["messages"])
    for event in events:
        validate_schema("JobProgress", event)
        assert event["jobId"] == "job-test"
    assert [e["progress"] for e in events] == sorted(e["progress"] for e in events)
    assert (tmp_path / "debug/camera-0.png").read_bytes().startswith(b"\x89PNG")
    debug = json.loads((tmp_path / "debug/index.json").read_text())
    assert debug["evidence"] == "synthetic"
    assert len(debug["cameras"]) == 3


@pytest.mark.parametrize("case", ["rotated", "vfr"])
def test_rotation_and_variable_timestamps_preserve_identity_and_position(capture, case):
    path, manifest, truth = capture(case)
    result = process_manifest(manifest, path, "synthetic")
    assert_positions(result, truth, manifest["participantIds"])
    if case == "vfr":
        pts = [pts for pts, _ in read_frames(Path(manifest["cameras"][0]["videoPath"]))]
        assert len(set(np.diff(pts).round(1))) >= 4
    else:
        assert result["cameras"][1]["frameWidth"] == truth["width"]
        assert result["cameras"][1]["frameHeight"] == truth["height"]


def test_uploaded_frame_layout_uses_decoded_rotated_dimensions_without_manual_corners(capture):
    path, original, truth = capture("rotated", count=6)
    manifest = copy.deepcopy(original)
    manifest["cameras"] = [manifest["cameras"][1]]
    manifest["cameras"][0].update(anchors=None, frameLayout="from-stage")
    result = process_manifest(manifest, path, "synthetic")
    assert result["cameras"][0]["frameWidth"] == truth["width"]
    assert result["cameras"][0]["frameHeight"] == truth["height"]
    localized = {p["deviceId"]: p for p in result["locations"] if p["status"] == "localized"}
    accepted = [o for o in result["observations"] if o["status"] == "accepted"]
    assert localized and len(localized) == len(accepted)
    for observation in accepted:
        location = localized[observation["deviceId"]]
        x, y = observation["centerPx"]["x"], observation["centerPx"]["y"]
        assert location["mappingMode"] == "frame-layout"
        assert np.allclose([location["x"], location["y"]],
                           [(1+(1-x/(truth["width"]-1)))/3, 1-y/(truth["height"]-1)])


@pytest.mark.parametrize("fps", [24, 60])
def test_supported_frame_rates_use_pts(capture, fps):
    path, manifest, truth = capture(count=6, fps=fps)
    result = process_manifest(manifest, path, "synthetic")
    assert_positions(result, truth, manifest["participantIds"])


def test_motion_color_shift_partial_cover_and_dropped_frames(capture):
    path, manifest, truth = capture("degraded", count=30)
    result = process_manifest(manifest, path, "synthetic")
    expected = manifest["participantIds"][:-1]  # Last phone is fully hidden throughout.
    assert_positions(result, truth, expected)
    assert result["locations"][-1]["status"] == "unseen"
    assert any(o["erasedBits"] > 0 and o["status"] == "accepted" for o in result["observations"])


def test_washed_pilots_clothing_glow_and_mixed_brightness_mp4(capture):
    path, manifest, truth = capture("emissive-background", count=12)
    result = process_manifest(manifest, path, "synthetic")
    assert_positions(result, truth, manifest["participantIds"])
    # Check every accepted camera observation against independent scene geometry;
    # a downstream geometry rejection must not conceal a wrong screen identity.
    phones = {p["deviceId"]: p for p in truth["phones"]}
    for observation in result["observations"]:
        if observation["status"] != "accepted":
            continue
        camera_index = next(i for i, c in enumerate(manifest["cameras"])
                            if c["cameraId"] == observation["cameraId"])
        phone = phones[observation["deviceId"]]
        low, high = camera_index/3 - .1, (camera_index+1)/3 + .1
        expected_x = truth["width"] * (high-phone["x"]) / (high-low) - .5
        expected_y = truth["height"] * (.94-.88*phone["y"]) - .5
        assert math.hypot(observation["centerPx"]["x"]-expected_x,
                          observation["centerPx"]["y"]-expected_y) < 2


def test_reflected_blue_glow_motion_and_single_frame_glare_keep_full_packets(capture):
    path, manifest, truth = capture("reflected-motion", count=6)
    result = process_manifest(manifest, path, "synthetic")
    assert_positions(result, truth, manifest["participantIds"])
    assert all(o["status"] == "accepted" and o["correctedBits"] == 0
               for o in result["observations"])


@pytest.mark.parametrize("case", ["wrong-tag", "empty"])
def test_wrong_run_and_no_screens_never_produce_locations(capture, case):
    path, manifest, _ = capture(case)
    result = process_manifest(manifest, path, "synthetic")
    assert all(p["status"] == "unseen" and p["x"] is None for p in result["locations"])
    assert not any(o["status"] == "accepted" for o in result["observations"])
    if case == "wrong-tag":
        assert any("wrong run tag" in o["reasons"] for o in result["observations"])


def test_reflection_identity_is_flagged_not_averaged(capture):
    path, manifest, truth = capture("duplicates")
    result = process_manifest(manifest, path, "synthetic")
    assert result["locations"][0]["status"] == "ambiguous"
    assert result["locations"][0]["x"] is None
    assert not any(o["status"] == "accepted" and o["deviceId"] == 0 for o in result["observations"])
    assert_positions(result, truth, manifest["participantIds"][1:])


def test_crossing_tracks_do_not_swap_accepted_ids(capture):
    path, manifest, truth = capture("crossing")
    result = process_manifest(manifest, path, "synthetic")
    crossing = {manifest["participantIds"][0], manifest["participantIds"][3]}
    assert all(p["status"] != "localized" for p in result["locations"] if p["deviceId"] in crossing)
    assert_positions(result, truth, set(manifest["participantIds"])-crossing)


def test_missing_camera_and_geometry_have_explicit_fallbacks(capture):
    path, manifest, truth = capture()
    fewer = copy.deepcopy(manifest)
    fewer["cameras"] = [fewer["cameras"][0], fewer["cameras"][2]]
    result = process_manifest(fewer, path, "synthetic")
    assert_positions(result, truth, [p["deviceId"] for p in truth["phones"]
                                     if p["column"] != "center"])
    one = copy.deepcopy(manifest)
    one["cameras"] = [one["cameras"][0]]
    one["cameras"][0]["anchors"] = None
    result = process_manifest(one, path, "synthetic")
    assert any(p["status"] == "coarse" for p in result["locations"])
    assert all(p["x"] is None and p["y"] is None for p in result["locations"])


def test_hash_failure_is_checked_before_any_camera_processing(capture, tmp_path):
    path, manifest, _ = capture()
    damaged = copy.deepcopy(manifest)
    damaged["cameras"][-1]["sha256"] = "0" * 64
    events = []
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        process_manifest(damaged, path, "synthetic", debug_dir=tmp_path / "debug",
                         progress=events.append)
    assert [event["stage"] for event in events] == ["validate"]
    assert not (tmp_path / "debug").exists()


def test_real_cli_relative_paths_progress_and_no_stale_overwrite(capture, tmp_path):
    path, manifest, truth = capture(count=6)
    relative = copy.deepcopy(manifest)
    for camera in relative["cameras"]:
        camera["videoPath"] = Path(camera["videoPath"]).name
    manifest_path = path / "relative-manifest.json"
    manifest_path.write_text(json.dumps(relative))
    output = tmp_path / "result.json"
    command = [sys.executable, "-m", "otc", "process", "--manifest", str(manifest_path),
               "--output", str(output), "--evidence", "synthetic", "--job-id", "cli-test"]
    process = subprocess.run(command, capture_output=True, text=True, check=False)
    assert process.returncode == 0, process.stderr
    result = json.loads(output.read_text())
    assert_positions(result, truth, manifest["participantIds"])
    events = [json.loads(line) for line in process.stdout.splitlines()]
    for event in events:
        validate_schema("JobProgress", event)
    assert events[-1]["stage"] == "complete" and events[-1]["progress"] == 1
    original = output.read_bytes()
    repeated = subprocess.run(command, capture_output=True, text=True, check=False)
    assert repeated.returncode == 2
    assert "already exists" in repeated.stderr
    assert output.read_bytes() == original
