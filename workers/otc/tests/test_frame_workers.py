from contextlib import closing
import multiprocessing as mp
import os
import time

import numpy as np
import pytest

from otc.frame_worker import _frame_entry, detected_frames
from otc import resources


def marker(rgb, pts, excluded):
    if pts == 0:
        time.sleep(.1)  # Later tasks can finish before the first frame.
    return (int(rgb[0, 0, 0]), pts, int(excluded.sum()), os.getpid())


def failing_marker(rgb, pts, excluded):
    if pts == 40:
        raise ValueError("deliberate detector failure")
    return marker(rgb, pts, excluded)


def frames(produced):
    for value, pts in enumerate((0, 40, 75, 110, 146, 177, 209)):
        produced.append(pts)
        yield pts, np.full((20, 30, 3), value, dtype=np.uint8)


def test_ordered_shared_frames_preserve_pixels_pts_exclusions_and_bounded_read_ahead():
    produced, observed, processes = [], [], set()
    polygon = [[{"x": 1, "y": 1}, {"x": 4, "y": 1}, {"x": 4, "y": 4}]]
    before = {p.pid for p in mp.active_children()}
    with closing(detected_frames(frames(produced), polygon, marker, 3)) as stream:
        for index, (pts, rgb, found) in enumerate(stream):
            assert found[:2] == (index, pts)
            assert np.all(rgb == index)
            assert found[2] > 0
            assert len(produced) <= index + 3
            observed.append(pts)
            processes.add(found[3])
    assert observed == produced
    assert len(processes) == 3 and os.getpid() not in processes
    assert {p.pid for p in mp.active_children()} <= before


def test_detector_failure_and_early_consumer_close_reap_frame_children():
    before = {p.pid for p in mp.active_children()}
    with pytest.raises(ValueError, match="deliberate detector failure"):
        list(detected_frames(frames([]), [], failing_marker, 3))
    assert {p.pid for p in mp.active_children()} <= before
    with closing(detected_frames(frames([]), [], marker, 3)) as stream:
        next(stream)
    assert {p.pid for p in mp.active_children()} <= before


def test_abrupt_frame_exit_fails_without_hanging_or_leaving_siblings():
    before = {p.pid for p in mp.active_children()}
    with closing(detected_frames(frames([]), [], marker, 3)) as stream:
        next(stream)
        child = next(p for p in mp.active_children() if p.pid not in before
                     and p.name == "otc-frame-0")
        child.terminate()
        child.join()
        with pytest.raises((ValueError, OSError)):
            list(stream)
    assert {p.pid for p in mp.active_children()} <= before


def test_dimension_changes_and_invalid_exclusions_fail_in_both_modes():
    for workers in (1, 2):
        def changed():
            yield 0, np.zeros((20, 30, 3), np.uint8)
            yield 40, np.zeros((21, 30, 3), np.uint8)
        with pytest.raises(ValueError, match="dimensions changed"):
            list(detected_frames(changed(), [], marker, workers))
        with pytest.raises(ValueError, match="outside rotated"):
            list(detected_frames(frames([]), [[{"x": -1, "y": 0}]], marker, workers))


def test_frame_worker_exits_when_camera_parent_pipe_closes():
    context = mp.get_context("spawn")
    shared = context.RawArray("B", 20*30*4)
    parent, child_end = context.Pipe()
    child = context.Process(target=_frame_entry,
                            args=(child_end, shared, (20, 30, 3), 1, 0, marker))
    child.start()
    child_end.close()
    try:
        parent.send(0)
        assert parent.recv()[0] == "result"
        parent.close()  # Same EOF as an abruptly killed camera parent.
        child.join(timeout=5)
        assert not child.is_alive()
        assert child.exitcode == 0
    finally:
        parent.close()
        if child.is_alive():
            child.terminate()
        child.join()
        child.close()


@pytest.mark.parametrize("cameras,expected", [(1, [24]), (2, [12, 12]), (3, [8, 8, 8])])
def test_railway_cpu_budget_is_shared_across_cameras(monkeypatch, cameras, expected):
    monkeypatch.setattr(resources, "cpu_capacity", lambda: 24)
    monkeypatch.setenv("OTC_CPU_BUDGET", "auto")
    assert resources.worker_allocation(cameras, 3) == (cameras, expected)
    assert resources.worker_allocation(cameras, 1) == (1, [1])


def test_smaller_cpu_allocation_queues_cameras_and_caps_explicit_budget(monkeypatch):
    monkeypatch.setattr(resources, "cpu_capacity", lambda: 2)
    assert resources.worker_allocation(3, 3, 24) == (2, [1, 1])
    monkeypatch.setenv("OTC_CPU_BUDGET", "1")
    assert resources.worker_allocation(3, 3) == (1, [1])
    monkeypatch.setenv("OTC_CPU_BUDGET", "invalid")
    with pytest.raises(ValueError, match="OTC_CPU_BUDGET"):
        resources.worker_allocation(3, 3)
    with pytest.raises(ValueError, match="positive"):
        resources.worker_allocation(3, 3, 0)


def test_cgroup_quota_and_affinity_bound_visible_host_cpus(monkeypatch, tmp_path):
    monkeypatch.setattr(os, "process_cpu_count", lambda: 64, raising=False)
    monkeypatch.setattr(os, "sched_getaffinity", lambda _: set(range(32)), raising=False)
    (tmp_path / "cpu.max").write_text("2400000 100000")
    assert resources.cpu_capacity(tmp_path) == 24
    (tmp_path / "cpu.max").write_text("150000 100000")
    assert resources.cpu_capacity(tmp_path) == 1
    (tmp_path / "cpu.max").write_text("max 100000")
    assert resources.cpu_capacity(tmp_path) == 32
    (tmp_path / "cpu.cfs_quota_us").write_text("600000")
    (tmp_path / "cpu.cfs_period_us").write_text("100000")
    assert resources.cpu_capacity(tmp_path) == 6
