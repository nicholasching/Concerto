"""Check decoded IDs against independent auditorium screen projections, not a seat map."""

import argparse
from collections import Counter
import json
from pathlib import Path

import cv2
import numpy as np

from otc.validation import validate_result


def check_auditorium(manifest, truth, result):
    validate_result(manifest, result)
    if truth["case"] != "auditorium-sweep" or result["evidence"] != "synthetic":
        raise ValueError("Requires the generated synthetic auditorium scene")
    phones = {phone["deviceId"]: phone for phone in truth["phones"]}
    by_camera = {}
    for camera in result["cameras"]:
        width, height = camera["frameWidth"], camera["frameHeight"]
        frame = np.array([[0, 0], [width-1, 0], [width-1, height-1], [0, height-1]], np.float32)
        screens = []
        for phone in phones.values():
            screen = next(s for s in phone["cameraScreens"] if s["cameraId"] == camera["cameraId"])
            polygon = np.array(screen["cornersPx"], np.float32)
            area, clipped = cv2.intersectConvexConvex(polygon, frame)
            if area <= 0:
                continue
            moments = cv2.moments(clipped)
            center = [moments["m10"]/moments["m00"], moments["m01"]/moments["m00"]]
            screens.append((phone["deviceId"], center, screen, polygon))
        by_camera[camera["cameraId"]] = screens
    accepted = [o for o in result["observations"] if o["status"] == "accepted"]
    mismatches, full_errors, clipped_errors = [], [], []
    partial = 0
    for observation in accepted:
        point = np.array([observation["centerPx"][key] for key in ("x", "y")])
        screens = by_camera[observation["cameraId"]]
        nearest = min(screens, key=lambda item: np.linalg.norm(point-item[1]))
        expected = next((s for s in screens if s[0] == observation["deviceId"]), None)
        reason = None
        if expected is None or nearest[0] != observation["deviceId"]:
            reason = "accepted ID does not match the nearest projected screen"
        elif cv2.pointPolygonTest(expected[3], tuple(point), True) < -1:
            reason = "accepted center is outside its own screen (1 px raster allowance)"
        else:
            clipped_errors.append(float(np.linalg.norm(point-expected[1])))
            screen = expected[2]
            if screen["visible"]:
                error = float(np.linalg.norm(point-[screen["centerPx"][key] for key in ("x", "y")]))
                full_errors.append(error)
                if error > 2:
                    reason = "fully in-frame screen exceeds the 2 px center tolerance"
            else:
                # A clipped screen's observed center is not its off-frame full center.
                partial += 1
        if reason:
            mismatches.append({"deviceId": observation["deviceId"],
                               "cameraId": observation["cameraId"], "reason": reason})
    ids = {o["deviceId"] for o in accepted}
    wrong_columns = [p["deviceId"] for p in result["locations"]
                     if p["status"] == "coarse" and p["column"] != phones[p["deviceId"]]["column"]]
    return {
        "evidence": "synthetic", "decoderVersion": result["decoderVersion"],
        "participants": len(phones), "uniqueAcceptedIds": len(ids),
        "missingIds": sorted(set(phones)-ids), "acceptedObservations": len(accepted),
        "identityOrCenterMismatches": mismatches, "partialScreenObservations": partial,
        "maximumFullyInFrameCenterErrorPx": max(full_errors, default=None),
        "fullyInFrameCenterTolerancePx": 2,
        "maximumClippedCentroidErrorPx": max(clipped_errors, default=None),
        "locationStatuses": dict(Counter(p["status"] for p in result["locations"])),
        "coarseWrongColumnIds": wrong_columns, "processingMs": result["processingMs"],
        "inputHashes": result["inputHashes"],
        "limitation": "Identity/column evidence only. Null anchors cannot produce a canonical "
                      "seat map. Partial-screen centroid errors are reported separately; "
                      "nearest-screen identity and polygon membership are still required.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("manifest", "truth", "result"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()
    summary = check_auditorium(**{name: json.loads(path.read_text(encoding="utf-8"))
                                  for name, path in vars(args).items()})
    print(json.dumps(summary, indent=2, allow_nan=False))
    raise SystemExit(bool(summary["missingIds"] or summary["identityOrCenterMismatches"] or
                          summary["coarseWrongColumnIds"]))
