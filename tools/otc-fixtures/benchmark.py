"""Measure a synthetic MP4 pipeline and its worker processes against independent truth."""

import argparse
from collections import Counter
import ctypes
import json
import math
import os
from pathlib import Path
import platform
import sys
import threading
import time

import av
import cv2
import numpy as np

from otc.__main__ import write_result
from otc.pipeline import process_manifest
from otc.resources import worker_allocation


def peak_memory_bytes():
    if sys.platform == "win32":
        from ctypes import wintypes

        class MemoryCounters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in (
                    "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                    "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage",
                    "PagefileUsage", "PeakPagefileUsage",
                )
            ]

        counters = MemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(MemoryCounters),
                                             wintypes.DWORD]
        if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters),
                                         counters.cb):
            raise ctypes.WinError(ctypes.get_last_error())
        return counters.PeakWorkingSetSize
    import resource
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return value if sys.platform == "darwin" else value * 1024


def windows_tree_reader():
    """Build a live working-set reader; never sum processes' lifetime peaks."""
    from ctypes import wintypes

    class ProcessEntry(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260),
        ]

    class MemoryCounters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in (
                "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage",
                "PagefileUsage", "PeakPagefileUsage",
            )
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    for name in ("Process32FirstW", "Process32NextW"):
        getattr(kernel, name).argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(MemoryCounters),
                                         wintypes.DWORD]

    def read():
        snapshot = kernel.CreateToolhelp32Snapshot(2, 0)  # TH32CS_SNAPPROCESS
        if snapshot == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        parents = {}
        try:
            entry = ProcessEntry()
            entry.dwSize = ctypes.sizeof(entry)
            present = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
            if not present:
                raise ctypes.WinError(ctypes.get_last_error())
            while present:
                parents[entry.th32ProcessID] = entry.th32ParentProcessID
                present = kernel.Process32NextW(snapshot, ctypes.byref(entry))
            if ctypes.get_last_error() != 18:  # ERROR_NO_MORE_FILES
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            kernel.CloseHandle(snapshot)
        pids = {os.getpid()}
        while added := {pid for pid, parent in parents.items() if parent in pids} - pids:
            pids.update(added)
        total, measured, missed = 0, 0, 0
        for pid in pids:
            handle = kernel.OpenProcess(0x1000 | 0x0010, False, pid)
            if not handle:
                missed += 1  # May have exited after the snapshot; expose the gap.
                continue
            try:
                counters = MemoryCounters()
                counters.cb = ctypes.sizeof(counters)
                if psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
                    total += counters.WorkingSetSize
                    measured += 1
                else:
                    missed += 1
            finally:
                kernel.CloseHandle(handle)
        return total, measured, missed
    return read


class ProcessTreeMemory:
    """Sample simultaneous resident sets, including spawned camera workers."""

    interval_ms = 100

    def __init__(self):
        self.reader = windows_tree_reader() if sys.platform == "win32" else None
        self.stop_event = threading.Event()
        self.thread = None
        self.peak = None
        self.samples = 0
        self.incomplete_samples = 0
        self.max_processes = 0
        self.error = None

    def sample(self):
        try:
            resident, count, missed = self.reader()
            self.max_processes = max(self.max_processes, count)
            self.samples += 1
            if missed or not count:
                self.incomplete_samples += 1
            else:
                self.peak = max(self.peak or 0, resident)
        except OSError as error:
            self.error = str(error)

    def run(self):
        while not self.stop_event.wait(self.interval_ms / 1000):
            self.sample()

    def __enter__(self):
        if self.reader:
            self.sample()
            self.thread = threading.Thread(target=self.run, daemon=True)
            self.thread.start()
        return self

    def __exit__(self, *_):
        if self.thread:
            self.stop_event.set()
            self.thread.join()
            self.sample()

    def metrics(self):
        return {
            "peakSampledProcessTreeResidentBytes": self.peak,
            "processTreeMemoryMethod": "Toolhelp32 descendants + sum of live WorkingSetSize"
                                       if self.reader else "unavailable on this platform",
            "memorySamplingIntervalMs": self.interval_ms,
            "memorySamples": self.samples,
            "incompleteMemorySamples": self.incomplete_samples,
            "maximumSampledProcessCount": self.max_processes,
            "memorySamplingError": self.error,
            "memorySamplingCaveat": "Sampled process-resident sum; shared pages may be counted "
                                    "more than once; peaks between samples can be missed. "
                                    "Incomplete samples are excluded from the peak.",
        }


def perspective_accuracy(expected, result):
    """Report truth-defined depth/size groups, including deliberate unresolved screens."""
    if not any("depth" in phone for phone in expected.values()):
        return {}
    locations = {point["deviceId"]: point for point in result["locations"]}
    accepted = {item["deviceId"] for item in result["observations"]
                if item["status"] == "accepted"}
    groups = {"depth": {}, "largestVisibleMinimumSidePx": {}}
    unexpected, missing, wrong_observations = [], [], []
    for observation in result["observations"]:
        if observation["status"] != "accepted":
            continue
        phone = expected[observation["deviceId"]]
        screen = next((s for s in phone["cameraScreens"]
                       if s["cameraId"] == observation["cameraId"]), None)
        error = (math.hypot(observation["centerPx"]["x"] - screen["centerPx"]["x"],
                            observation["centerPx"]["y"] - screen["centerPx"]["y"])
                 if screen else None)
        if (phone.get("expectedUnresolvable") or not screen or not screen["visible"]
                or error >= 2):
            wrong_observations.append({"deviceId": observation["deviceId"],
                                       "cameraId": observation["cameraId"],
                                       "trackId": observation["trackId"], "positionErrorPx": error})
    for device_id, phone in expected.items():
        resolvable = not phone.get("expectedUnresolvable", False)
        if not resolvable and device_id in accepted:
            unexpected.append(device_id)
        if resolvable and locations[device_id]["status"] != "localized":
            missing.append(device_id)
        depth = phone["depth"]
        side = max((min(screen["widthPx"], screen["heightPx"])
                    for screen in phone["cameraScreens"] if screen["visible"]), default=0)
        labels = {
            "depth": "front" if depth < 1 / 3 else "middle" if depth < 2 / 3 else "back",
            "largestVisibleMinimumSidePx": "under4" if side < 4 else "4to7" if side < 8
                                           else "8to15" if side < 16 else "16plus",
        }
        for axis, label in labels.items():
            counts = groups[axis].setdefault(label, Counter())
            counts["participants"] += 1
            counts["expectedResolvable"] += resolvable
            counts["localizedExpectedResolvable"] += (
                resolvable and locations[device_id]["status"] == "localized")
            counts["unexpectedAccepted"] += not resolvable and device_id in accepted
            for size in ("widthPx", "heightPx"):
                values = [screen[size] for screen in phone["cameraScreens"] if screen["visible"]]
                if values:
                    previous = counts.get(size + "Range", values)
                    counts[size + "Range"] = [min(min(previous), min(values)),
                                              max(max(previous), max(values))]
    for bins in groups.values():
        for counts in bins.values():
            counts["resolvableRecall"] = (counts["localizedExpectedResolvable"] /
                                           counts["expectedResolvable"]
                                           if counts["expectedResolvable"] else None)
    return {"accuracyGroups": groups, "unexpectedAcceptedUnresolvableIds": unexpected,
            "missingExpectedResolvableIds": missing, "wrongAcceptedObservations": wrong_observations,
            "observationPositionErrorTolerancePx": 2}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--truth", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--workers", choices=(1, 3), type=int, default=3)
    parser.add_argument("--cpu-budget", type=int)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    truth = json.loads(args.truth.read_text(encoding="utf-8"))
    if truth["evidence"] != "synthetic":
        parser.error("Benchmark requires generated synthetic ground truth")
    expected = {p["deviceId"]: p for p in truth["phones"]}
    if set(expected) != set(manifest["participantIds"]):
        parser.error("Ground truth and manifest participants differ")
    args.output_dir.mkdir(parents=True, exist_ok=False)
    start = time.perf_counter()
    with ProcessTreeMemory() as memory, \
            (args.output_dir / "progress.ndjson").open("w", encoding="utf-8") as progress:
        def report(event):
            progress.write(json.dumps(event) + "\n")
            progress.flush()
        result = process_manifest(manifest, args.manifest.resolve().parent, "synthetic",
                                  progress=report, workers=args.workers, cpu_budget=args.cpu_budget)
    write_result(args.output_dir / "result.json", result)
    elapsed_ms = (time.perf_counter() - start) * 1000
    errors, wrong = [], []
    for point in result["locations"]:
        if point["status"] != "localized":
            continue
        ground = expected[point["deviceId"]]
        error = math.hypot(point["x"] - ground["x"], point["y"] - ground["y"])
        errors.append(error)
        if point["column"] != ground["column"] or error >= .015:
            wrong.append(point["deviceId"])
    camera_concurrency, frame_workers = worker_allocation(len(manifest["cameras"]), args.workers,
                                                        args.cpu_budget)
    metrics = {
        "evidence": "synthetic", "case": truth["case"], "seed": truth["seed"],
        "participants": len(expected), "statuses": dict(Counter(p["status"] for p in result["locations"])),
        "wrongLocalizedIds": wrong, "positionErrorTolerance": .015,
        "maximumPositionError": max(errors, default=None), "wallMs": elapsed_ms,
        "processingMs": result["processingMs"], "workersRequested": args.workers,
        "cameraWorkerProcesses": camera_concurrency if camera_concurrency > 1 else 0,
        "frameWorkersPerCameraSlot": frame_workers,
        "cpuBudgetRequested": args.cpu_budget,
        "parentPeakResidentBytes": peak_memory_bytes(),
        "parentMemoryMethod": "GetProcessMemoryInfo(self).PeakWorkingSetSize"
                              if sys.platform == "win32" else "getrusage(RUSAGE_SELF).ru_maxrss",
        **memory.metrics(),
        "python": platform.python_version(), "platform": platform.platform(),
        "av": av.__version__, "opencv": cv2.__version__, "numpy": np.__version__,
        "inputHashes": result["inputHashes"], "debugArtifactsEnabled": False,
        **perspective_accuracy(expected, result),
    }
    write_result(args.output_dir / "metrics.json", metrics)
    print(json.dumps(metrics, indent=2))
    return int(bool(wrong) or bool(metrics.get("unexpectedAcceptedUnresolvableIds")) or
               bool(metrics.get("missingExpectedResolvableIds")) or
               bool(metrics.get("wrongAcceptedObservations")) or
               (truth["case"] == "clean" and len(errors) != len(expected)))


if __name__ == "__main__":
    raise SystemExit(main())
