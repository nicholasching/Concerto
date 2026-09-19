"""Explicit validation/fixture harness. The process subcommand is reserved for Team 3."""

import argparse
import json
import sys
from pathlib import Path

from jsonschema.exceptions import ValidationError

from .validation import validate_manifest, validate_result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("validate-manifest", "replay-fixture", "process"):
        command = commands.add_parser(name)
        command.add_argument("--manifest", type=Path, required=True)
        if name != "validate-manifest":
            command.add_argument("--output", type=Path, required=True)
        if name == "replay-fixture":
            command.add_argument("--fixture", type=Path, required=True)
    args = parser.parse_args()
    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        validate_manifest(manifest)
        if args.command == "process":
            raise ValueError("Video decoder not implemented. Team 3 owns process; no locations produced.")
        if args.command == "validate-manifest":
            print(json.dumps({"valid": True, "runId": manifest["runId"], "videoFilesChecked": False}))
            return 0
        result = json.loads(args.fixture.read_text(encoding="utf-8"))
        validate_result(manifest, result)
        if result["evidence"] != "synthetic":
            raise ValueError("Fixture replay requires evidence=synthetic")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"replayed": True, "synthetic": True, "output": str(args.output)}))
        return 0
    except (OSError, ValueError, ValidationError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
