import copy
import json
import subprocess
import sys

import pytest
from jsonschema import Draft7Validator
from jsonschema.exceptions import ValidationError

from otc.validation import ROOT, validate_manifest, validate_result, validate_schema


def fixture(path):
    return json.loads((ROOT / "fixtures" / path).read_text())


@pytest.mark.parametrize("path,name", [
    ("admin-snapshot.json", "AdminSnapshot"),
    ("participant-snapshot.json", "ParticipantSnapshot"),
    ("show.json", "Show"),
    ("client-message.json", "ClientMessage"),
])
def test_same_wire_examples_as_typescript(path, name):
    validate_schema(name, fixture(path))


def test_every_generated_schema_is_valid():
    registry = json.loads((ROOT / "packages/contracts/generated/schemas.json").read_text())
    for schema in registry.values():
        Draft7Validator.check_schema(schema)


def test_result_and_manifest_match():
    validate_result(fixture("otc/clean-30/manifest.json"), fixture("otc/clean-30/result.json"))


def test_duplicate_ids_and_wrong_runs_are_rejected():
    manifest = fixture("otc/clean-30/manifest.json")
    duplicate = copy.deepcopy(manifest)
    duplicate["participantIds"].append(0)
    with pytest.raises(ValueError, match="Duplicate"):
        validate_manifest(duplicate)
    result = fixture("otc/clean-30/result.json")
    result["runTag"] = 38
    with pytest.raises(ValueError, match="identity mismatch"):
        validate_result(manifest, result)


def test_unknown_location_cannot_be_zero_zero():
    result = fixture("otc/clean-30/result.json")
    result["locations"][-1]["x"] = 0
    result["locations"][-1]["y"] = 0
    with pytest.raises(ValidationError):
        validate_schema("OtcResult", result)


def test_real_process_does_not_fake_a_decode(tmp_path):
    output = tmp_path / "result.json"
    process = subprocess.run(
        [sys.executable, "-m", "otc", "process", "--manifest",
         str(ROOT / "fixtures/otc/clean-30/manifest.json"), "--output", str(output)],
        capture_output=True, text=True, check=False,
    )
    assert process.returncode == 2
    assert "not implemented" in process.stderr
    assert not output.exists()


def test_replay_is_explicit_and_preserves_synthetic_evidence(tmp_path):
    output = tmp_path / "result.json"
    process = subprocess.run(
        [sys.executable, "-m", "otc", "replay-fixture", "--manifest",
         str(ROOT / "fixtures/otc/clean-30/manifest.json"), "--fixture",
         str(ROOT / "fixtures/otc/clean-30/result.json"), "--output", str(output)],
        capture_output=True, text=True, check=False,
    )
    assert process.returncode == 0, process.stderr
    assert json.loads(output.read_text())["evidence"] == "synthetic"
