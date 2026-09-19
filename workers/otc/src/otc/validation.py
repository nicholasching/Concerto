"""Validate the generated shared schema and worker-specific invariants."""

import json
from pathlib import Path

from jsonschema import Draft7Validator

ROOT = Path(__file__).resolve().parents[4]


def validate_schema(name: str, value: dict) -> None:
    # Python's JSON parser accepts NaN/Infinity by default; wire JSON must not.
    json.dumps(value, allow_nan=False)
    registry = json.loads((ROOT / "packages/contracts/generated/schemas.json").read_text())
    Draft7Validator(registry[name]).validate(value)


def validate_manifest(manifest: dict) -> None:
    validate_schema("CalibrationManifest", manifest)
    ids = manifest["participantIds"]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate participant IDs")
    cameras = [camera["cameraId"] for camera in manifest["cameras"]]
    if len(cameras) != len(set(cameras)):
        raise ValueError("Duplicate camera IDs")


def validate_result(manifest: dict, result: dict) -> None:
    validate_manifest(manifest)
    validate_schema("OtcResult", result)
    for key in ("protocolVersion", "sessionId", "serverEpoch", "runId", "runTag"):
        if manifest[key] != result[key]:
            raise ValueError(f"Result identity mismatch: {key}")
    expected = {camera["cameraId"]: camera["sha256"] for camera in manifest["cameras"]}
    actual = {camera["cameraId"]: camera["sha256"] for camera in result["inputHashes"]}
    if actual != expected or len(actual) != len(result["inputHashes"]):
        raise ValueError("Result input hashes do not match the manifest")
    participant_ids = set(manifest["participantIds"])
    location_ids = [location["deviceId"] for location in result["locations"]]
    if len(location_ids) != len(set(location_ids)) or set(location_ids) != participant_ids:
        raise ValueError("Result must contain each participant location exactly once")
    diagnostics = {camera["cameraId"]: camera for camera in result["cameras"]}
    if set(diagnostics) != set(expected) or len(diagnostics) != len(result["cameras"]):
        raise ValueError("Result camera diagnostics do not match the manifest")
    track_keys = set()
    accepted_keys = set()
    for observation in result["observations"]:
        if observation["cameraId"] not in expected:
            raise ValueError("Observation references an unknown camera")
        if observation["status"] == "accepted" and observation["deviceId"] not in participant_ids:
            raise ValueError("Accepted observation is not in the participant set")
        track_key = (observation["cameraId"], observation["trackId"])
        if track_key in track_keys:
            raise ValueError("Duplicate camera track observation")
        track_keys.add(track_key)
        if observation["firstPtsMs"] > observation["lastPtsMs"]:
            raise ValueError("Observation timestamps are reversed")
        camera = diagnostics[observation["cameraId"]]
        point = observation["centerPx"]
        if not (0 <= point["x"] < camera["frameWidth"] and
                0 <= point["y"] < camera["frameHeight"]):
            raise ValueError("Observation lies outside rotated frame dimensions")
        if observation["status"] == "accepted":
            accepted_key = (observation["cameraId"], observation["deviceId"])
            if accepted_key in accepted_keys:
                raise ValueError("Duplicate accepted identity in a camera")
            accepted_keys.add(accepted_key)
    for location in result["locations"]:
        sources = location["sourceCameraIds"]
        if not set(sources) <= set(expected) or len(sources) != len(set(sources)):
            raise ValueError("Invalid location camera references")
        if location["status"] == "localized" and not any(
            (camera_id, location["deviceId"]) in accepted_keys for camera_id in sources
        ):
            raise ValueError("Localized device lacks accepted optical evidence")
