"""Measure a synthetic MP4 pipeline in this process against independent truth."""

import argparse
from collections import Counter
import ctypes
import json
import math
from pathlib import Path
import platform
import sys
import time

import av
import cv2
import numpy as np

from otc.__main__ import write_result
from otc.pipeline import process_manifest


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--truth", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
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
    with (args.output_dir / "progress.ndjson").open("w", encoding="utf-8") as progress:
        def report(event):
            progress.write(json.dumps(event) + "\n")
            progress.flush()
        result = process_manifest(manifest, args.manifest.resolve().parent, "synthetic",
                                  progress=report)
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
    metrics = {
        "evidence": "synthetic", "case": truth["case"], "seed": truth["seed"],
        "participants": len(expected), "statuses": dict(Counter(p["status"] for p in result["locations"])),
        "wrongLocalizedIds": wrong, "positionErrorTolerance": .015,
        "maximumPositionError": max(errors, default=None), "wallMs": elapsed_ms,
        "processingMs": result["processingMs"], "peakProcessResidentBytes": peak_memory_bytes(),
        "memoryMethod": "GetProcessMemoryInfo(self).PeakWorkingSetSize" if sys.platform == "win32"
                        else "getrusage(RUSAGE_SELF).ru_maxrss",
        "python": platform.python_version(), "platform": platform.platform(),
        "av": av.__version__, "opencv": cv2.__version__, "numpy": np.__version__,
        "inputHashes": result["inputHashes"], "debugArtifactsEnabled": False,
    }
    write_result(args.output_dir / "metrics.json", metrics)
    print(json.dumps(metrics, indent=2))
    return int(bool(wrong) or (truth["case"] == "clean" and len(errors) != len(expected)))


if __name__ == "__main__":
    raise SystemExit(main())
