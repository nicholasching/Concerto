import copy
import hashlib
import json
import multiprocessing
import os
import re
import subprocess
import sys

import pytest

from otc.pipeline import process_manifest
from otc.validation import validate_result, validate_schema


def camera_processes(events):
    processes = {}
    for event in events:
        match = re.fullmatch(r"Decoding camera (.+) in process (\d+)", event["message"])
        if match:
            processes[match[1]] = int(match[2])
    return processes


def damaged_manifest(capture, tmp_path):
    path, manifest, _ = capture(count=6)
    damaged = copy.deepcopy(manifest)
    invalid_video = tmp_path / "invalid-camera.mp4"
    invalid_video.write_bytes(b"This file has a valid manifest hash, but no video stream.\n")
    damaged["cameras"][1].update(
        videoPath=str(invalid_video),
        sha256=hashlib.sha256(invalid_video.read_bytes()).hexdigest(),
    )
    return path, damaged


def cli_command(manifest_path, output):
    return [sys.executable, "-m", "otc", "process", "--manifest", str(manifest_path),
            "--output", str(output), "--evidence", "synthetic", "--job-id", "parallel-cli"]


def test_parallel_matches_serial_with_ordered_artifacts_and_parent_progress(capture, tmp_path):
    path, manifest, _ = capture(count=6)
    ordered = copy.deepcopy(manifest)
    ordered["cameras"] = [ordered["cameras"][2], ordered["cameras"][0], ordered["cameras"][1]]
    serial = process_manifest(ordered, path, "synthetic", workers=1)
    events, callback_pids = [], []

    def record(event):
        events.append(event)
        callback_pids.append(os.getpid())

    result = process_manifest(ordered, path, "synthetic", workers=3,
                              debug_dir=tmp_path / "debug", job_id="parallel-test", progress=record)
    validate_result(ordered, result)
    assert {k: v for k, v in result.items() if k != "processingMs"} == {
        k: v for k, v in serial.items() if k != "processingMs"
    }
    assert all(point["status"] == "localized" for point in result["locations"])
    expected_cameras = [camera["cameraId"] for camera in ordered["cameras"]]
    assert [camera["cameraId"] for camera in result["cameras"]] == expected_cameras
    assert list(dict.fromkeys(o["cameraId"] for o in result["observations"])) == expected_cameras
    assert set(callback_pids) == {os.getpid()}
    for event in events:
        validate_schema("JobProgress", event)
        assert event["jobId"] == "parallel-test"
        assert event["runId"] == ordered["runId"]
    assert [e["progress"] for e in events] == sorted(e["progress"] for e in events)
    processes = camera_processes(events)
    assert set(processes) == set(expected_cameras)
    assert len(set(processes.values())) == 3
    assert os.getpid() not in processes.values()
    debug = json.loads((tmp_path / "debug/index.json").read_text())
    assert debug["finalObservations"] == result["observations"]
    assert [camera["cameraId"] for camera in debug["cameras"]] == expected_cameras
    for index, camera_id in enumerate(expected_cameras):
        assert (tmp_path / f"debug/camera-{index}.png").read_bytes().startswith(b"\x89PNG")
        detail = json.loads((tmp_path / f"debug/camera-{index}.json").read_text())
        assert detail["cameraId"] == camera_id
        observations = {o["trackId"]: o for o in result["observations"] if o["cameraId"] == camera_id}
        assert {track["trackId"] for track in detail["tracks"]} == set(observations)
        for track in detail["tracks"]:
            assert track["status"] == observations[track["trackId"]]["status"]


def test_parallel_camera_failure_reaps_started_children(capture, tmp_path):
    path, manifest = damaged_manifest(capture, tmp_path)
    before = {child.pid for child in multiprocessing.active_children()}
    events = []
    with pytest.raises(ValueError):
        process_manifest(manifest, path, "synthetic", workers=3, progress=events.append)
    assert {child.pid for child in multiprocessing.active_children()} <= before
    assert any(event["stage"] == "decode" for event in events)
    assert all(event["stage"] not in ("register", "complete") for event in events)


def test_abrupt_camera_exit_fails_and_reaps_other_children(capture):
    path, manifest, _ = capture(count=6)
    before = {child.pid for child in multiprocessing.active_children()}
    terminated = []

    def terminate_camera(event):
        processes = camera_processes([event])
        if processes and not terminated:
            pid = next(iter(processes.values()))
            child = next(child for child in multiprocessing.active_children()
                         if child.pid == pid and child.pid not in before)
            child.terminate()
            terminated.append(pid)

    with pytest.raises(ValueError, match="worker exited without a result"):
        process_manifest(manifest, path, "synthetic", workers=3, progress=terminate_camera)
    assert len(terminated) == 1
    assert {child.pid for child in multiprocessing.active_children()} <= before


def test_progress_callback_failure_reaps_camera_children(capture):
    path, manifest, _ = capture(count=6)
    before = {child.pid for child in multiprocessing.active_children()}

    def fail_callback(event):
        if event["stage"] == "decode":
            raise RuntimeError("Progress consumer disconnected")

    with pytest.raises(RuntimeError, match="Progress consumer disconnected"):
        process_manifest(manifest, path, "synthetic", workers=3, progress=fail_callback)
    assert {child.pid for child in multiprocessing.active_children()} <= before


def test_cli_defaults_to_three_camera_processes_and_publishes_complete(capture, tmp_path):
    _, manifest, _ = capture(count=6)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    output = tmp_path / "result.json"
    completed = subprocess.run(cli_command(manifest_path, output), capture_output=True,
                               text=True, check=False, timeout=60)
    assert completed.returncode == 0, completed.stderr
    result = json.loads(output.read_text())
    validate_result(manifest, result)
    assert all(point["status"] == "localized" for point in result["locations"])
    events = [json.loads(line) for line in completed.stdout.splitlines()]
    for event in events:
        validate_schema("JobProgress", event)
    assert len(set(camera_processes(events).values())) == 3
    assert [e["progress"] for e in events] == sorted(e["progress"] for e in events)
    assert events[-1]["stage"] == "complete"
    assert events[-1]["progress"] == 1


def test_cli_parallel_camera_failure_never_publishes_success(capture, tmp_path):
    _, manifest = damaged_manifest(capture, tmp_path)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    output = tmp_path / "result.json"
    completed = subprocess.run(cli_command(manifest_path, output), capture_output=True,
                               text=True, check=False, timeout=60)
    assert completed.returncode == 2
    assert json.loads(completed.stderr)["error"]
    assert not output.exists()
    events = [json.loads(line) for line in completed.stdout.splitlines()]
    for event in events:
        validate_schema("JobProgress", event)
    assert any(event["stage"] == "decode" for event in events)
    assert not any(event["stage"] == "complete" for event in events)
