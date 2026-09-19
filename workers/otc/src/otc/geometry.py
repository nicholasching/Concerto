"""Manual column geometry, validated overlap registration and conservative fusion."""

from collections import defaultdict
from dataclasses import dataclass
import itertools

import cv2
import numpy as np

COLUMNS = ("left", "center", "right")


@dataclass
class Mapping:
    matrix: np.ndarray
    support: np.ndarray
    mode: str
    residual_px: float | None = None

    def project(self, point):
        if cv2.pointPolygonTest(self.support.astype(np.float32), tuple(map(float, point)), False) < 0:
            return None
        transformed = project_points(self.matrix, [point])
        if transformed is None:
            return None
        x, y = transformed[0]
        if not (-1e-6 <= x <= 1+1e-6 and -1e-6 <= y <= 1+1e-6):
            return None
        return np.clip([x, y], 0, 1)


def project_points(matrix, points):
    homogeneous = np.column_stack([points, np.ones(len(points))]) @ matrix.T
    if (np.abs(homogeneous[:, 2]) < 1e-8).any():
        return None
    result = homogeneous[:, :2] / homogeneous[:, 2:3]
    return result if np.isfinite(result).all() else None


def manual_mapping(camera, width, height):
    if camera["anchors"] is None:
        return None
    points = np.array([[p["x"], p["y"]] for p in camera["anchors"]], dtype=np.float32)
    if ((points < 0).any() or (points[:, 0] >= width).any() or
            (points[:, 1] >= height).any() or not cv2.isContourConvex(points) or
            abs(cv2.contourArea(points)) < 16):
        raise ValueError(f"Invalid ordered anchors for {camera['cameraId']}")
    column = COLUMNS.index(camera["primaryColumn"])
    target = np.array([[column/3, 0], [(column+1)/3, 0],
                       [(column+1)/3, 1], [column/3, 1]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(points, target)
    if not np.isfinite(matrix).all() or np.linalg.cond(matrix) > 1e12:
        raise ValueError("Degenerate camera anchors")
    return Mapping(matrix, points, "manual-anchors")


def _spread(points, dimensions):
    width, height = dimensions
    points = np.asarray(points, dtype=np.float32)
    hull = cv2.convexHull(points).reshape(-1, 2)
    return (np.ptp(points[:, 0]) >= width * 0.18 and
            np.ptp(points[:, 1]) >= height * 0.18 and
            cv2.contourArea(hull) >= width * height * 0.02)


def fit_overlap(source, reference, source_size, reference_size, reference_mapping):
    """Fit on a deterministic training split; test independent held-out points."""
    source = np.asarray(source, dtype=np.float64)
    reference = np.asarray(reference, dtype=np.float64)
    if (len(source) < 8 or not _spread(source, source_size) or
            not _spread(reference, reference_size)):
        return None
    holdout = np.arange(len(source)) % 4 == 0
    cv2.setRNGSeed(0)
    matrix, inliers = cv2.findHomography(
        source[~holdout], reference[~holdout], cv2.RANSAC, 3.0
    )
    if matrix is None or inliers is None or inliers.sum() < 5 or inliers.mean() < 0.8:
        return None
    predicted = project_points(matrix, source)
    if predicted is None:
        return None
    residuals = np.linalg.norm(predicted-reference, axis=1)
    if (residuals[holdout].max() > 5 or
            np.median(residuals[~holdout][inliers.ravel().astype(bool)]) > 2):
        return None
    trusted = np.concatenate([source[holdout], source[~holdout][inliers.ravel().astype(bool)]])
    support = cv2.convexHull(trusted.astype(np.float32)).reshape(-1, 2)
    canonical = reference_mapping.matrix @ matrix
    corners = project_points(canonical, support)
    if corners is None or (corners < -0.01).any() or (corners > 1.01).any():
        return None
    return Mapping(canonical, support, "overlap", float(residuals[holdout].max()))


def reject_duplicates(observations):
    groups = defaultdict(list)
    for observation in observations:
        if observation["status"] == "accepted":
            groups[(observation["cameraId"], observation["deviceId"])].append(observation)
    blocked = {device_id for (_, device_id), items in groups.items() if len(items) > 1}
    for observation in observations:
        if observation["deviceId"] in blocked:
            observation["status"] = "ambiguous"
            observation["reasons"].append("duplicate identity in one camera; possible reflection")
    return blocked


def build_mappings(manifest, dimensions, observations):
    mappings = {}
    for camera in manifest["cameras"]:
        camera_id = camera["cameraId"]
        manual = manual_mapping(camera, *dimensions[camera_id])
        mappings[camera_id] = [manual] if manual else []
    by_camera = defaultdict(dict)
    for observation in observations:
        if observation["status"] == "accepted":
            p = observation["centerPx"]
            by_camera[observation["cameraId"]][observation["deviceId"]] = [p["x"], p["y"]]
    # At most three views: permit a validated chain from a manually anchored view.
    for _ in range(len(mappings)):
        changed = False
        for source_id, source_maps in mappings.items():
            if any(mapping.mode == "overlap" for mapping in source_maps):
                continue
            best, best_count = None, 0
            for reference_id, reference_maps in mappings.items():
                if reference_id == source_id:
                    continue
                for reference_map in reference_maps:
                    common = sorted(set(by_camera[source_id]) & set(by_camera[reference_id]))
                    common = [device_id for device_id in common
                              if reference_map.project(by_camera[reference_id][device_id]) is not None]
                    if len(common) < 8 or len(common) <= best_count:
                        continue
                    candidate = fit_overlap(
                        [by_camera[source_id][i] for i in common],
                        [by_camera[reference_id][i] for i in common],
                        dimensions[source_id], dimensions[reference_id], reference_map,
                    )
                    if candidate:
                        best, best_count = candidate, len(common)
            if best is not None:
                # Preserve independent primary-column anchors. Replacing them
                # with a neighbour's overlap can make conflicting ROIs appear
                # to agree; overlap extends coverage outside the primary ROI.
                source_maps.append(best)
                changed = True
        if not changed:
            break
    return mappings


def fuse_locations(manifest, observations, mappings, blocked):
    by_device = defaultdict(list)
    cameras = {camera["cameraId"]: camera for camera in manifest["cameras"]}
    for observation in observations:
        if observation["deviceId"] is not None:
            by_device[observation["deviceId"]].append(observation)
    locations, warnings = [], []
    for device_id in manifest["participantIds"]:
        evidence = by_device[device_id]
        accepted = [o for o in evidence if o["status"] == "accepted"]
        base = {
            "deviceId": device_id, "column": None, "x": None, "y": None,
            "sourceCameraIds": sorted({o["cameraId"] for o in evidence}),
            "decodeScore": max((o["decodeScore"] for o in evidence), default=None),
            "mappingResidualPx": None, "status": "unseen", "mappingMode": "none",
        }
        mapped = []
        for observation in accepted:
            point = observation["centerPx"]
            for mapping in mappings[observation["cameraId"]]:
                position = mapping.project([point["x"], point["y"]])
                if position is not None:
                    mapped.append((position, mapping, observation["decodeScore"],
                                   observation["cameraId"]))
                    break
        if device_id in blocked:
            base["status"] = "ambiguous"
            warnings.append(f"Device {device_id}: duplicate optical identity; no location assigned")
        elif mapped:
            positions = [item[0] for item in mapped]
            columns = {min(2, int(position[0] * 3)) for position in positions}
            conflict = (len(columns) != 1 or any(
                np.linalg.norm(a-b) > 0.04 for a, b in itertools.combinations(positions, 2)
            ))
            if conflict:
                base["status"] = "ambiguous"
                warnings.append(f"Device {device_id}: camera positions or columns conflict")
            else:
                preferred = max(mapped, key=lambda item: (
                    item[1].mode == "manual-anchors", item[2]
                ))
                position = preferred[0]
                residuals = [item[1].residual_px for item in mapped if item[1].residual_px is not None]
                base.update(
                    status="localized", x=float(position[0]), y=float(position[1]),
                    column=COLUMNS[next(iter(columns))],
                    mappingMode=preferred[1].mode,
                    mappingResidualPx=max(residuals) if residuals else None,
                    sourceCameraIds=sorted({item[3] for item in mapped}),
                    decodeScore=max(item[2] for item in mapped),
                )
        elif accepted:
            columns = {cameras[o["cameraId"]]["primaryColumn"] for o in accepted}
            if len(columns) == 1 and all(not mappings[o["cameraId"]] for o in accepted):
                base.update(status="coarse", column=next(iter(columns)), mappingMode="optical-column",
                            sourceCameraIds=sorted({o["cameraId"] for o in accepted}),
                            decodeScore=max(o["decodeScore"] for o in accepted))
            else:
                base["status"] = "ambiguous"
                warnings.append(f"Device {device_id}: no trustworthy position within mapped support")
        elif evidence:
            base["status"] = "ambiguous"
        locations.append(base)
    return locations, warnings
