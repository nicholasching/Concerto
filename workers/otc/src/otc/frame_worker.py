"""Bounded parallel frame analysis; yield every frame in original PTS order."""

from collections import deque
from contextlib import closing
import multiprocessing as mp

import cv2
import numpy as np


def exclusion_mask(shape, polygons):
    height, width = shape[:2]
    excluded = np.zeros((height, width), np.uint8)
    for polygon in polygons:
        points = np.array([[p["x"], p["y"]] for p in polygon], dtype=np.float64)
        if (not np.isfinite(points).all() or (points < 0).any() or
                (points[:, 0] >= width).any() or (points[:, 1] >= height).any()):
            raise ValueError("Exclusion ROI lies outside rotated video dimensions")
        cv2.fillPoly(excluded, [points.round().astype(np.int32)], 255)
    return excluded


def _frame_entry(connection, shared, shape, slots, index, detect):
    cv2.setNumThreads(1)
    pixels = int(np.prod(shape))
    storage = np.frombuffer(shared, dtype=np.uint8)
    rgb = storage[index*pixels:(index+1)*pixels].reshape(shape)
    excluded = storage[slots*pixels:].reshape(shape[:2])
    rgb.flags.writeable = excluded.flags.writeable = False
    try:
        while True:
            pts_ms = connection.recv()
            if pts_ms is None:
                break
            try:
                connection.send(("result", detect(rgb, pts_ms, excluded)))
            except Exception as error:
                connection.send(("error", f"{type(error).__name__}: {error}"))
                break
    except (EOFError, BrokenPipeError, ConnectionResetError):
        pass  # Camera parent was cancelled; do not leave idle descendants alive.
    finally:
        connection.close()


def detected_frames(frames, polygons, detect, workers=1):
    """Share a fixed ring of RGB buffers, never pickle or queue entire movies.

    The yielded RGB view is valid until the next iteration. Only independent
    detection runs in children; the consumer retains ordered, stateful tracking.
    RawArray uses OS-backed shared storage and supports Windows spawn without
    requiring a container to enlarge its usually small /dev/shm mount.
    """
    with closing(frames):
        first = next(frames, None)
        if first is None:
            return
        shape = first[1].shape
        excluded = exclusion_mask(shape, polygons)

        def checked_frames():
            yield first
            for pts_ms, rgb in frames:
                if rgb.shape != shape:
                    raise ValueError("Video dimensions changed during capture")
                yield pts_ms, rgb

        if workers == 1:
            for pts_ms, rgb in checked_frames():
                yield pts_ms, rgb, detect(rgb, pts_ms, excluded)
            return

        context = mp.get_context("spawn")
        pixels = int(np.prod(shape))
        shared = context.RawArray("B", workers*pixels + excluded.size)
        storage = np.frombuffer(shared, dtype=np.uint8)
        buffers = storage[:workers*pixels].reshape((workers, *shape))
        storage[workers*pixels:] = excluded.ravel()
        children, connections, pending = [], [], deque()
        source = checked_frames()
        try:
            for index in range(workers):
                frame = next(source, None)
                if frame is None:
                    break
                connection, receiver = context.Pipe()
                connections.append(connection)
                child = context.Process(target=_frame_entry,
                                        args=(receiver, shared, shape, workers, index, detect),
                                        name=f"otc-frame-{index}")
                try:
                    child.start()
                finally:
                    receiver.close()
                children.append(child)
                pts_ms, rgb = frame
                np.copyto(buffers[index], rgb)
                connection.send(pts_ms)
                pending.append((index, pts_ms))
            while pending:
                index, pts_ms = pending.popleft()
                try:
                    kind, payload = connections[index].recv()
                except (EOFError, OSError) as error:
                    raise ValueError("Frame worker exited without a result") from error
                if kind == "error":
                    raise ValueError(f"Frame worker: {payload}")
                yield pts_ms, buffers[index], payload
                frame = next(source, None)
                if frame is not None:
                    next_pts, rgb = frame
                    np.copyto(buffers[index], rgb)
                    connections[index].send(next_pts)
                    pending.append((index, next_pts))
            for connection in connections:
                connection.send(None)
            for child in children:
                child.join(timeout=1)
        finally:
            for child in children:
                if child.is_alive():
                    child.terminate()
            for child in children:
                child.join()
                child.close()
            for connection in connections:
                connection.close()
