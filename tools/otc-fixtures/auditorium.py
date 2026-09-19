"""Original swept/tiered auditorium fixture; reference-inspired, not survey geometry."""

import argparse
import copy
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path

import av
import cv2
import numpy as np

from otc.validation import ROOT, validate_manifest

ROWS = 30
SEAT_PITCH_M = .58
AISLE_EXTRA_M = 1.2
PHONE_WIDTH_M, PHONE_HEIGHT_M = .08, .16
COLUMNS = ("left", "center", "right")


def seating(count=1500):
    if not 3 * ROWS <= count <= 2048:
        raise ValueError("Use 90..2048 phones across the 30 auditorium rows")
    radii = 10 + .9 * np.arange(ROWS)
    quotas = count * radii / radii.sum()
    counts = np.floor(quotas).astype(int)
    for row in np.argsort(-(quotas-counts), kind="stable")[:count-int(counts.sum())]:
        counts[row] += 1
    phones, rows = [], []
    ids = [0, 2047, 1024, 1] + [i for i in range(2, 2047) if i != 1024]
    for row, (radius, seats) in enumerate(zip(radii, counts)):
        # Increasing risers give the back rows a clear line of sight in this
        # synthetic bowl. These dimensions are assumptions, not venue measurements.
        floor = .26 * row + .01 * row * row
        blocks = [int(seats//3)] * 3
        for block in (1, 0, 2)[:int(seats % 3)]:
            blocks[block] += 1
        span = seats * SEAT_PITCH_M + 2 * AISLE_EXTRA_M
        cursor = -span/2
        row_blocks = []
        for column, block_count in enumerate(blocks):
            start = cursor
            end = start + block_count * SEAT_PITCH_M
            row_blocks.append([start/radius, end/radius])
            for seat in range(block_count):
                theta = (start + (seat+.5)*SEAT_PITCH_M) / radius
                phones.append({
                    "deviceId": ids[len(phones)], "row": row, "seatInBlock": seat,
                    "column": COLUMNS[column], "depth": (row+.5)/ROWS,
                    "x": (column+(seat+.5)/block_count)/3, "y": (row+.5)/ROWS,
                    "worldMeters": [float(radius*math.sin(theta)), float(floor+1.35),
                                    float(radius*math.cos(theta))],
                    "thetaRadians": float(theta), "expectedUnresolvable": False,
                    "cameraScreens": [],
                })
            cursor = end + AISLE_EXTRA_M
        rows.append({"row": row, "radiusM": float(radius), "floorHeightM": float(floor),
                     "seats": int(seats), "blockAnglesRadians": row_blocks})
    return phones, rows


def view_camera(camera_id, width, height):
    yaw = {"overview": 0, "camera-left": -27, "camera-center": 0, "camera-right": 27}[camera_id]
    fov = 94 if camera_id == "overview" else 54
    yaw, pitch = math.radians(yaw), math.radians(13)
    forward = np.array([math.sin(yaw)*math.cos(pitch), math.sin(pitch),
                        math.cos(yaw)*math.cos(pitch)])
    right = np.array([math.cos(yaw), 0, -math.sin(yaw)])
    up = np.cross(forward, right)
    position = np.array([0, 1., 0])  # Fixed stage cameras with different aim directions.
    focal = width / (2*math.tan(math.radians(fov)/2))

    def project(points):
        relative = np.asarray(points, dtype=float)-position
        distance = relative @ forward
        if (distance <= 0).any():
            raise ValueError("Scene point is behind the virtual camera")
        # Audience-left is image-right from the stage, matching the frozen map convention.
        pixels = np.column_stack([width/2 - focal*(relative @ right)/distance,
                                  height*.61 - focal*(relative @ up)/distance])
        return pixels
    return project, {"cameraId": camera_id, "positionMeters": position.tolist(),
                     "yawDegrees": math.degrees(yaw), "pitchDegrees": 13,
                     "horizontalFovDegrees": fov, "frameWidth": width, "frameHeight": height}


def screen_polygon(phone, project, screen_width=PHONE_WIDTH_M, screen_height=PHONE_HEIGHT_M,
                   height_offset=0):
    center = np.array(phone["worldMeters"]) + [0, height_offset, 0]
    angle = phone["thetaRadians"]
    tangent = np.array([math.cos(angle), 0, -math.sin(angle)]) * screen_width/2
    vertical = np.array([0, screen_height/2, 0])
    return project([center-tangent+vertical, center+tangent+vertical,
                    center+tangent-vertical, center-tangent-vertical])


def prepare_view(phones, rows, camera_id, width, height):
    project, camera = view_camera(camera_id, width, height)
    background = np.full((height, width, 3), 9, np.uint8)
    # Monochrome row terraces and seat backs reveal spacing without flashing as IDs.
    for row in reversed(rows):
        for start, end in row["blockAnglesRadians"]:
            angles = np.linspace(start, end, 80)
            points = []
            for radius, sweep in ((row["radiusM"]-.4, angles),
                                  (row["radiusM"]+.4, angles[::-1])):
                points.extend([[radius*math.sin(t), row["floorHeightM"], radius*math.cos(t)]
                               for t in sweep])
            polygon = np.rint(project(points)).astype(np.int32)
            shade = 19 + 3*(row["row"] % 2)
            cv2.fillPoly(background, [polygon], (shade,)*3)
            cv2.polylines(background, [polygon[:80]], False, (42,)*3, 1, cv2.LINE_AA)
    for phone in reversed(phones):
        chair = np.rint(screen_polygon(phone, project, .40, .38, -.65)).astype(np.int32)
        cv2.fillConvexPoly(background, chair, (27,)*3)
        cv2.polylines(background, [chair], True, (58,)*3, 1, cv2.LINE_AA)
    font_size = width/2400
    cv2.putText(background, f"SYNTHETIC AUDITORIUM  /  {len(phones):,} PHONES  /  {camera_id}",
                (round(width*.025), round(height*.055)), cv2.FONT_HERSHEY_SIMPLEX,
                font_size, (190,)*3, max(1, round(font_size)), cv2.LINE_AA)
    cv2.putText(background, "30 curved tiers  |  3 seating blocks  |  fixed stage camera",
                (round(width*.025), round(height*.09)), cv2.FONT_HERSHEY_SIMPLEX,
                font_size*.65, (135,)*3, max(1, round(font_size*.65)), cv2.LINE_AA)
    rendered = []
    for phone in phones:
        corners = screen_polygon(phone, project)
        polygon = np.rint(corners).astype(np.int32)
        x, y, w, h = cv2.boundingRect(polygon)
        visible = x >= 0 and y >= 0 and x+w <= width and y+h <= height
        center = project([phone["worldMeters"]])[0]
        phone["cameraScreens"].append({
            "cameraId": camera_id, "centerPx": {"x": float(center[0]), "y": float(center[1])},
            "widthPx": w, "heightPx": h, "visible": visible,
            "cornersPx": corners.tolist(),
        })
        if x < width and y < height and x+w > 0 and y+h > 0:
            rendered.append((phone["deviceId"], polygon))
    return background, rendered, camera


def generate_auditorium(output_dir, count=1500, width=3840, height=2160):
    if min(width, height) < 120 or width % 2 or height % 2:
        raise ValueError("Dimensions must be even and at least 120 pixels")
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=False)
    phones, rows = seating(count)
    manifest = copy.deepcopy(json.loads((ROOT / "fixtures/otc/clean-30/manifest.json").read_text()))
    manifest["runId"] = "synthetic-auditorium-sweep-1500" if count == 1500 else f"synthetic-auditorium-{count}"
    manifest["participantIds"] = [p["deviceId"] for p in phones]
    words = json.loads((ROOT / "packages/contracts/generated/otc-codebook.json").read_text())["codewords"]
    packets = {}
    for device_id in manifest["participantIds"]:
        word = [int(bit) for bit in words[device_id]]
        packets[device_id] = ([None, None, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0]
                             + [int(bit) for bit in f"{manifest['runTag']:08b}"] + word
                             + [1-bit for bit in word] + [None, None])
    colors = {None: (17, 17, 17), 0: (255, 176, 0), 1: (0, 102, 255)}
    captures = []
    views = ["overview"] + [c["cameraId"] for c in manifest["cameras"]]
    for index, camera_id in enumerate(views):
        background, rendered, camera = prepare_view(phones, rows, camera_id, width, height)
        start_ms = (900, 710, 970, 1310)[index]
        path = output_dir / f"{camera_id}.mp4"
        print(json.dumps({"stage": "render", "view": camera_id, "phonesInFrame": len(rendered)}),
              flush=True)
        with av.open(str(path), "w") as container:
            stream = container.add_stream("libx264", rate=30)
            stream.width, stream.height, stream.pix_fmt = width, height, "yuv420p"
            stream.codec_context.thread_count = 2
            stream.time_base = stream.codec_context.time_base = Fraction(1, 1000)
            stream.options = {"crf": "21", "preset": "ultrafast", "tune": "zerolatency"}
            for frame_index in range(405):
                pts_ms = round(frame_index*1000/30)
                slot = math.floor((pts_ms-start_ms)/200)
                rgb = background.copy()
                for device_id, polygon in reversed(rendered):
                    symbol = packets[device_id][slot] if 0 <= slot < 55 else None
                    cv2.fillConvexPoly(rgb, polygon, colors[symbol])
                if frame_index == 65:
                    cv2.imwrite(str(output_dir / f"{camera_id}-preview.png"),
                                cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
                frame = av.VideoFrame.from_ndarray(rgb, format="rgb24")
                frame.pts, frame.time_base = pts_ms, Fraction(1, 1000)
                for packet in stream.encode(frame):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
        sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        footprints = [next(s for s in p["cameraScreens"] if s["cameraId"] == camera_id) for p in phones]
        visible = [s for s in footprints if s["visible"]]
        captures.append({**camera, "videoPath": str(path), "sha256": sha256, "phasePtsMs": start_ms,
                         "fullyInFramePhones": len(visible), "renderedPhones": len(rendered),
                         "screenWidthPxRange": [min(s["widthPx"] for s in visible),
                                                max(s["widthPx"] for s in visible)],
                         "screenHeightPxRange": [min(s["heightPx"] for s in visible),
                                                 max(s["heightPx"] for s in visible)]})
        if index:
            manifest["cameras"][index-1].update(videoPath=str(path), sha256=sha256,
                                               rotationDegrees=0, anchors=None)
    validate_manifest(manifest)
    summary = {"evidence": "synthetic", "case": "auditorium-sweep", "participants": count,
               "fps": 30, "durationSeconds": 13.5, "framesPerView": 405,
               "rows": rows, "seatPitchMeters": SEAT_PITCH_M, "aisleExtraMeters": AISLE_EXTRA_M,
               "physicalScreenMeters": [PHONE_WIDTH_M, PHONE_HEIGHT_M], "captures": captures,
               "geometryNote": "Approximate original curved/raked bowl; not calibrated to the photo. "
                               "Balcony, people and sensor effects omitted. Anchors intentionally null: "
                               "this 3D scene is not a single planar homography. Fully in-frame counts "
                               "describe frustum coverage, not visibility after screen overlap."}
    for name, value in (("manifest.json", manifest), ("scene.json", summary),
                        ("ground-truth.json", {"evidence": "synthetic", "case": "auditorium-sweep",
                                               "phones": phones})):
        (output_dir / name).write_text(json.dumps(value, indent=2, allow_nan=False)+"\n", encoding="utf-8")
    print(json.dumps({"stage": "complete", "overview": str(output_dir / "overview.mp4")}), flush=True)
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--count", type=int, default=1500)
    parser.add_argument("--width", type=int, default=3840)
    parser.add_argument("--height", type=int, default=2160)
    args = parser.parse_args()
    generate_auditorium(**vars(args))
