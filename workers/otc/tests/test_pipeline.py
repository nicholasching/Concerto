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
    assert any(o["status"] == "rejected" for o in result["observations"])  # Stage light.
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
