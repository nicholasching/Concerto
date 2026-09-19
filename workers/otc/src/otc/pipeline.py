"""Offline MP4 -> observations -> reviewed-candidate map; no authoritative writes."""

from collections import Counter
import json
from pathlib import Path
import time

import cv2
import numpy as np

from .camera_worker import run_cameras
from .geometry import build_mappings, fuse_locations, reject_duplicates
from .validation import validate_manifest, validate_result, validate_schema
from .video import verify_video

DECODER_VERSION = "otc-v1.1"


def process_manifest(manifest, base_dir, evidence, *, job_id=None, debug_dir=None, progress=None,
                     workers=3):
    start = time.perf_counter()
    validate_manifest(manifest)
    if evidence not in ("synthetic", "physical"):
        raise ValueError("Input provenance must be declared synthetic or physical")
    if type(workers) is not int or workers not in (1, 3):
        raise ValueError("workers must be 1 (serial reference) or 3 (one process per camera)")
    job_id = job_id or manifest["runId"]

    def report(stage, fraction, message):
        event = {"protocolVersion": 1, "jobId": job_id, "runId": manifest["runId"],
                 "stage": stage, "progress": fraction, "message": message}
        validate_schema("JobProgress", event)
        if progress:
            progress(event)

    report("validate", 0, "Validating input files and SHA-256 hashes")
    paths = []
    for camera in manifest["cameras"]:
        path = Path(camera["videoPath"])
        if not path.is_absolute():
            path = Path(base_dir) / path
        path = path.resolve()
        verify_video(path, camera["sha256"])
        paths.append(path)
    if debug_dir is not None:
        debug_dir = Path(debug_dir).resolve()
        if debug_dir.exists() and any(debug_dir.iterdir()):
            raise ValueError("Debug directory must be new or empty")
        debug_dir.mkdir(parents=True, exist_ok=True)
    cv2.setNumThreads(1)
    observations, diagnostics, artifacts = [], [], []
    dimensions = {}
    camera_results = run_cameras(manifest, paths, debug_dir, workers, report)
    for camera, result in zip(manifest["cameras"], camera_results):
        observations.extend(result["observations"])
        dimensions[camera["cameraId"]] = result["dimensions"]
        diagnostics.append(result["diagnostic"])
        if result["artifact"] is not None:
            artifacts.append(result["artifact"])
    report("register", 0.85, "Applying anchors, validating overlap and checking duplicate identities")
    blocked = reject_duplicates(observations)
    mappings = build_mappings(manifest, dimensions, observations)
    locations, warnings = fuse_locations(manifest, observations, mappings, blocked)
    for diagnostic in diagnostics:
        camera_id = diagnostic["cameraId"]
        statuses = Counter(o["status"] for o in observations if o["cameraId"] == camera_id)
        diagnostic["acceptedTracks"] = statuses["accepted"]
        diagnostic["rejectedTracks"] = statuses["ambiguous"] + statuses["rejected"]
        reasons = Counter(reason for o in observations
                          if o["cameraId"] == camera_id and o["status"] != "accepted"
                          for reason in o["reasons"])
        diagnostic["messages"].extend(f"{reason}: {total} track(s)"
                                      for reason, total in reasons.most_common(5))
        modes = [mapping.mode for mapping in mappings[camera_id]]
        diagnostic["messages"].append(
            f"Mapping options: {', '.join(modes)}" if modes else
            "No trustworthy geometry: primary-column evidence only"
        )
        if "overlap" not in modes:
            diagnostic["messages"].append(
                "Insufficient distributed, validated overlap; retaining manual/coarse fallback"
            )
    result = {
        **{key: manifest[key] for key in ("protocolVersion", "sessionId", "serverEpoch", "runId", "runTag")},
        "evidence": evidence, "decoderVersion": DECODER_VERSION,
        "inputHashes": [{"cameraId": c["cameraId"], "sha256": c["sha256"]} for c in manifest["cameras"]],
        "observations": observations, "locations": locations, "cameras": diagnostics,
        "warnings": warnings, "processingMs": (time.perf_counter()-start)*1000,
    }
    validate_result(manifest, result)
    if debug_dir is not None:
        for artifact in artifacts:
            annotated = cv2.imread(str(debug_dir / artifact["preview"]))
            camera_observations = {
                o["trackId"]: o for o in observations if o["cameraId"] == artifact["cameraId"]
            }
            for track_id, center in artifact["previewCenters"].items():
                observation = camera_observations[track_id]
                color = (60, 220, 60) if observation["status"] == "accepted" else (50, 150, 255)
                label = str(observation["deviceId"]) if observation["deviceId"] is not None else "?"
                cv2.circle(annotated, tuple(center), 6, color, 1)
                cv2.putText(annotated, label, (center[0]+7, center[1]),
                            cv2.FONT_HERSHEY_SIMPLEX, .35, color, 1)
            if not cv2.imwrite(str(debug_dir / artifact["preview"]), annotated):
                raise ValueError("Could not write annotated preview")
            detail_path = debug_dir / artifact["tracks"]
            detail = json.loads(detail_path.read_text(encoding="utf-8"))
            for track in detail["tracks"]:
                observation = camera_observations[track["trackId"]]
                track.update(status=observation["status"], deviceId=observation["deviceId"],
                             reasons=observation["reasons"])
            detail_path.write_text(json.dumps(detail, indent=2, allow_nan=False) + "\n",
                                   encoding="utf-8")
        (debug_dir / "index.json").write_text(json.dumps({
            "runId": manifest["runId"], "evidence": evidence, "cameras": artifacts,
            "mappingSupport": {
                camera_id: [{"mode": m.mode, "supportPx": np.asarray(m.support).tolist(),
                             "matrix": m.matrix.tolist(), "heldOutResidualPx": m.residual_px}
                            for m in items]
                for camera_id, items in mappings.items()
            },
            "finalObservations": observations, "locations": locations,
        }, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return result
