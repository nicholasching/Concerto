"""Validate, explicitly replay fixtures, or process original calibration videos."""

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

import av
import cv2
from jsonschema.exceptions import ValidationError

from .diagnostic import run_camera
from .pipeline import process_manifest
from .validation import validate_manifest, validate_result


def write_result(output, result):
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent,
                                         suffix=".tmp", delete=False) as target:
            temporary = Path(target.name)
            json.dump(result, target, indent=2, allow_nan=False)
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


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
        if name == "process":
            command.add_argument("--evidence", choices=("physical", "synthetic"), required=True,
                                 help="Explicit input provenance; the decoder cannot infer it")
            command.add_argument("--job-id", help="Backend job ID; defaults to run ID for direct CLI")
            command.add_argument("--debug-dir", type=Path)
            command.add_argument("--workers", type=int, choices=(1, 3), default=3,
                                 help="3: one process per camera; 1: serial reference")
    diagnostic = commands.add_parser("diagnose-camera", help="Open a local candidate-detection monitor")
    diagnostic.add_argument("--camera", type=int, default=0, help="Local webcam index (default: 0)")
    args = parser.parse_args()
    try:
        if args.command == "diagnose-camera":
            run_camera(args.camera)
            return 0
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        validate_manifest(manifest)
        if args.command == "validate-manifest":
            print(json.dumps({"valid": True, "runId": manifest["runId"], "videoFilesChecked": False}))
            return 0
        if args.command == "process":
            if args.output.exists():
                raise ValueError("Output already exists; use a new path for each processing attempt")
            def report(event):
                print(json.dumps(event, allow_nan=False), flush=True)
            result = process_manifest(
                manifest, args.manifest.resolve().parent, args.evidence,
                job_id=args.job_id, debug_dir=args.debug_dir, progress=report,
                workers=args.workers,
            )
            write_result(args.output, result)
            report({"protocolVersion": 1, "jobId": args.job_id or manifest["runId"],
                    "runId": manifest["runId"], "stage": "complete", "progress": 1,
                    "message": f"Validated result written to {args.output}"})
        else:
            result = json.loads(args.fixture.read_text(encoding="utf-8"))
            validate_result(manifest, result)
            if result["evidence"] != "synthetic":
                raise ValueError("Fixture replay requires evidence=synthetic")
            write_result(args.output, result)
            print(json.dumps({"replayed": True, "synthetic": True, "output": str(args.output)}))
        return 0
    except (OSError, RuntimeError, ValueError, ValidationError, av.FFmpegError, cv2.error) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
