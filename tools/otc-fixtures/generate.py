"""Seeded actual MP4 fixtures. Ground truth comes from scene placement, not decoding."""

import argparse
import copy
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path

import av
import numpy as np

from otc.validation import ROOT, validate_manifest

CASES = ("clean", "degraded", "wrong-tag", "duplicates", "crossing", "rotated", "vfr", "empty")


def generate_capture(output_dir, case="clean", count=30, fps=30, width=640, height=360, seed=7):
    if case not in CASES or not 1 <= count <= 2048 or fps not in (24, 30, 60):
        raise ValueError("Unsupported fixture case/count/FPS")
    if min(width, height) < 120 or width % 2 or height % 2:
        raise ValueError("Fixture dimensions must be even and at least 120 pixels")
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = copy.deepcopy(json.loads((ROOT / "fixtures/otc/clean-30/manifest.json").read_text()))
    manifest["runId"] = f"synthetic-{case}-{seed}"
    ids = ([0, 2047, 1024, 1] + [i for i in range(2, 2047) if i != 1024])[:count]
    manifest["participantIds"] = ids
    words = json.loads((ROOT / "packages/contracts/generated/otc-codebook.json").read_text())
    rng = np.random.default_rng(seed)
    columns = max(2, math.ceil(math.sqrt(math.ceil(count / 3) / 2)))
    rows = math.ceil(math.ceil(count / 3) / columns)
    phones = []
    for index, device_id in enumerate(ids):
        column, local = index % 3, index // 3
        phones.append({
            "deviceId": device_id, "x": (column + ((local % columns) + 0.5) / columns) / 3,
            "y": ((local // columns) + 0.5) / rows,
            "column": ("left", "center", "right")[column],
            "motionPhase": float(rng.uniform(0, 2 * math.pi)),
        })
    tag = manifest["runTag"] + (case == "wrong-tag")
    packets = {}
    for device_id in ids:
        word = [int(bit) for bit in words["codewords"][device_id]]
        packets[device_id] = ([None, None, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0]
                             + [int(bit) for bit in f"{tag:08b}"] + word
                             + [1-bit for bit in word] + [None, None])
    colors = {
        0: np.array([255, 176, 0], dtype=np.float64),
        1: np.array([0, 102, 255], dtype=np.float64),
        None: np.array([17, 17, 17], dtype=np.float64),
    }
    times = []
    t = 0.0
    while t < 13500:
        times.append(t)
        t += (33, 47, 25, 41)[len(times) % 4] if case == "vfr" else 1000 / fps
    phases = [710.0, 970.0, 1310.0]

    for camera_index, camera in enumerate(manifest["cameras"]):
        low, high = camera_index / 3 - 0.1, (camera_index + 1) / 3 + 0.1

        def project(x, y):
            # Camera looks toward audience: left/right and front/back are reversed.
            return width * (high-x) / (high-low), height * (0.94 - 0.88*y)

        camera["anchors"] = [dict(zip(("x", "y"), project(x, y))) for x, y in (
            (camera_index/3, 0), ((camera_index+1)/3, 0),
            ((camera_index+1)/3, 1), (camera_index/3, 1),
        )]
        camera["rotationDegrees"] = 90 if case == "rotated" and camera_index == 1 else 0
        path = output_dir / f"camera-{camera_index}.mp4"
        with av.open(str(path), "w") as container:
            stream = container.add_stream("libx264", rate=fps)
            stream.width, stream.height = ((height, width) if camera["rotationDegrees"] else
                                           (width, height))
            stream.pix_fmt = "yuv420p"
            stream.codec_context.thread_count = 2
            stream.time_base = stream.codec_context.time_base = Fraction(1, 1000)
            stream.options = {"crf": "25", "preset": "ultrafast", "tune": "zerolatency"}
            for frame_index, pts_ms in enumerate(times):
                if case in ("degraded", "vfr") and frame_index % 89 == 40:
                    continue
                rgb = np.full((height, width, 3), 9, np.uint8)
                rgb[6:18, 6:38] = [180, 20, 180]  # Non-packet stage-light distractor.
                slot = math.floor((pts_ms - phases[camera_index]) / 200)
                for index, phone in enumerate(phones):
                    device_id = phone["deviceId"]
                    if case == "empty" or (case == "degraded" and device_id == ids[-1]):
                        continue
                    x, y = project(phone["x"], phone["y"])
                    if case == "crossing" and len(phones) > 3 and index in (0, 3):
                        other_x, _ = project(phones[3 if index == 0 else 0]["x"], phone["y"])
                        fraction = min(1, max(0, ((pts_ms-phases[camera_index])/200-22)/6))
                        x += (other_x-x) * fraction
                    if case in ("degraded", "vfr"):
                        x += 1.6 * math.sin(pts_ms / 700 + phone["motionPhase"])
                        y += 1.1 * math.cos(pts_ms / 600 + phone["motionPhase"])
                    bit = packets[device_id][slot] if 0 <= slot < 55 else None
                    color = colors[bit]
                    if case == "degraded":
                        color = color * np.array([0.79, 0.91, 0.84])
                        if index == 2 and slot == 25:
                            continue  # One full data-slot erasure.
                    x0, y0 = round(x-5), round(y-8)
                    if 0 <= x0 < width-10 and 0 <= y0 < height-16:
                        rgb[y0:y0+16, x0:x0+10] = color.clip(0, 255).astype(np.uint8)
                        if case == "degraded" and index == 5 and 23 <= slot <= 28:
                            rgb[y0:y0+16, x0:x0+5] = 9  # Half-covered phone, then uncovered.
                if case == "duplicates" and camera_index == 0:
                    bit = packets[ids[0]][slot] if 0 <= slot < 55 else None
                    rgb[25:41, 60:70] = colors[bit].astype(np.uint8)
                if camera["rotationDegrees"]:
                    rgb = np.ascontiguousarray(np.rot90(rgb))
                frame = av.VideoFrame.from_ndarray(rgb, format="rgb24")
                frame.pts, frame.time_base = round(pts_ms), Fraction(1, 1000)
                for packet in stream.encode(frame):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
        camera["videoPath"] = str(path)
        camera["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    validate_manifest(manifest)
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    truth = {"evidence": "synthetic", "seed": seed, "case": case, "fps": fps,
             "width": width, "height": height, "cameraPhasePtsMs": phases,
             "phones": [{k: v for k, v in p.items() if k != "motionPhase"} for p in phones]}
    (output_dir / "ground-truth.json").write_text(json.dumps(truth, indent=2) + "\n")
    return manifest, truth


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--case", choices=CASES, default="clean")
    parser.add_argument("--count", type=int, default=30)
    parser.add_argument("--fps", type=int, choices=(24, 30, 60), default=30)
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=360)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    generate_capture(**vars(args))
    print(json.dumps({"manifest": str(args.output_dir / "manifest.json"),
                      "evidence": "synthetic", "decoderUsedForTruth": False}))
