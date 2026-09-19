"""Independent camera processing and bounded, spawn-safe process orchestration."""

import json
import multiprocessing as mp
from multiprocessing.connection import wait
import os

import cv2

from .sampling import decode_tracks
from .tracking import scan_camera


def process_camera(index, camera, path, manifest, debug_dir, report):
    cv2.setNumThreads(1)
    camera_id = camera["cameraId"]
    report("decode", f"Decoding camera {camera_id} in process {os.getpid()}")

    def on_frames(frames, pts_ms):
        report("track", f"{camera_id}: {frames} frames, clip PTS {pts_ms:.1f} ms")

    scan = scan_camera(path, camera, on_frames)
    seen, details, phase, messages = decode_tracks(scan, manifest, camera_id)
    diagnostic = {
        "cameraId": camera_id, "frameWidth": scan.width, "frameHeight": scan.height,
        "phasePtsMs": phase, "acceptedTracks": 0, "rejectedTracks": 0,
        "messages": [f"{scan.frame_count} frames; PTS relative to first decoded frame",
                     "Rotation applied clockwise from manifest, once"] + messages,
    }
    artifact = None
    if debug_dir is not None:
        # Each worker owns unique fixed filenames; no images/trajectories cross IPC.
        filename = f"camera-{index}"
        by_id = {track.track_id: track for track in scan.tracks}
        preview_pts = scan.preview_pts_ms
        centers = {}
        for observation in seen:
            track = by_id[observation["trackId"]]
            sample = min(track.samples, key=lambda item: abs(item.pts_ms-preview_pts))
            centers[observation["trackId"]] = [round(sample.x), round(sample.y)]
        if not cv2.imwrite(str(debug_dir / f"{filename}.png"),
                           cv2.cvtColor(scan.preview, cv2.COLOR_RGB2BGR)):
            raise ValueError("Could not write debug preview")
        (debug_dir / f"{filename}.json").write_text(json.dumps({
            "cameraId": camera_id, "previewPtsMs": scan.preview_pts_ms, "tracks": details,
        }, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        artifact = {"cameraId": camera_id, "preview": f"{filename}.png",
                    "tracks": f"{filename}.json", "previewCenters": centers}
    return {"observations": seen, "diagnostic": diagnostic, "artifact": artifact,
            "dimensions": (scan.width, scan.height)}


def _camera_entry(sender, index, camera, path, manifest, debug_dir):
    try:
        def report(stage, message):
            sender.send(("progress", (stage, message)))
        result = process_camera(index, camera, path, manifest, debug_dir, report)
        sender.send(("result", result))
    except Exception as error:
        sender.send(("error", f"{type(error).__name__}: {error}"))
    finally:
        sender.close()


def run_cameras(manifest, paths, debug_dir, workers, report):
    """Return camera results in manifest order; clean all children on any failure.

    The parent alone emits public progress. Spawn avoids inheriting native codec
    thread state and works on Windows. Backend cancellation must kill the entire
    process tree if it forcefully kills this parent (finally cannot run then).
    """
    count = len(paths)
    if workers == 1:
        results = []
        for index, (camera, path) in enumerate(zip(manifest["cameras"], paths)):
            def on_progress(stage, message):
                report(stage, .05 + .75 * index / count, message)
            results.append(process_camera(index, camera, path, manifest, debug_dir, on_progress))
        return results

    context = mp.get_context("spawn")
    children, readers, pending = [], [], {}
    results = [None] * count
    completed = 0
    try:
        for index, (camera, path) in enumerate(zip(manifest["cameras"], paths)):
            receiver, sender = context.Pipe(duplex=False)
            readers.append(receiver)
            child = context.Process(target=_camera_entry,
                                    args=(sender, index, camera, path, manifest, debug_dir),
                                    name=f"otc-camera-{index}")
            try:
                child.start()
            finally:
                sender.close()
            children.append(child)
            pending[receiver] = index
        while pending:
            for receiver in wait(list(pending)):
                index = pending[receiver]
                camera_id = manifest["cameras"][index]["cameraId"]
                try:
                    kind, payload = receiver.recv()
                except EOFError as error:
                    raise ValueError(f"Camera {camera_id}: worker exited without a result") from error
                if kind == "error":
                    raise ValueError(f"Camera {camera_id}: {payload}")
                if kind == "progress":
                    stage, message = payload
                    report(stage, .05 + .75 * completed / count, message)
                elif kind == "result":
                    results[index] = payload
                    del pending[receiver]
                    completed += 1
                    report("track", .05 + .75 * completed / count,
                           f"Completed camera {camera_id} ({completed}/{count})")
        # Results have arrived; allow normal interpreter shutdown before cleanup.
        for child in children:
            child.join(timeout=1)
        return results
    finally:
        for child in children:
            if child.is_alive():
                child.terminate()
        for child in children:
            child.join()
            child.close()
        for receiver in readers:
            receiver.close()
