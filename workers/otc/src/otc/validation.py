"""Validate the generated shared schema and worker-specific invariants."""

import json
from pathlib import Path

from jsonschema import Draft7Validator

ROOT = Path(__file__).resolve().parents[4]


def validate_schema(name: str, value: dict) -> None:
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
    if len(location_ids) != len(set(location_ids)) or not set(location_ids) <= participant_ids:
        raise ValueError("Result has duplicate or out-of-run location IDs")
    for observation in result["observations"]:
        if observation["cameraId"] not in expected:
            raise ValueError("Observation references an unknown camera")
        if observation["status"] == "accepted" and observation["deviceId"] not in participant_ids:
            raise ValueError("Accepted observation is not in the participant set")
