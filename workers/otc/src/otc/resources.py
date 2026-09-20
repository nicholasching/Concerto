"""Bound OTC CPU concurrency to the current process/container allocation."""

import math
import os
from pathlib import Path


def cpu_capacity(cgroup_root=Path("/sys/fs/cgroup")):
    capacity = getattr(os, "process_cpu_count", os.cpu_count)() or 1
    if hasattr(os, "sched_getaffinity"):
        capacity = min(capacity, len(os.sched_getaffinity(0)))
    # v2 in container namespaces, plus v1's standard CPU controller mount.
    # Parent quotas also constrain a process in a nested v2 cgroup.
    directories = [cgroup_root]
    try:
        for line in Path("/proc/self/cgroup").read_text().splitlines():
            if line.startswith("0::"):
                relative = line[3:].lstrip("/")
                child = cgroup_root / relative
                if ".." not in Path(relative).parts:
                    directories.extend([child, *child.parents])
    except OSError:
        pass
    for directory in set(directories):
        if directory != cgroup_root and cgroup_root not in directory.parents:
            continue
        try:
            quota, period = (directory / "cpu.max").read_text().split()
            if quota != "max":
                capacity = min(capacity, max(1, math.floor(int(quota) / int(period))))
        except (OSError, ValueError, ZeroDivisionError):
            pass
    for directory in (cgroup_root / "cpu", cgroup_root / "cpu,cpuacct", cgroup_root):
        try:
            quota = int((directory / "cpu.cfs_quota_us").read_text())
            period = int((directory / "cpu.cfs_period_us").read_text())
            if quota > 0:
                capacity = min(capacity, max(1, math.floor(quota / period)))
        except (OSError, ValueError, ZeroDivisionError):
            pass
    return max(1, capacity)


def worker_allocation(camera_count, camera_workers, cpu_budget=None):
    capacity = cpu_capacity()
    if cpu_budget is None:
        configured = "1" if camera_workers == 1 else os.environ.get("OTC_CPU_BUDGET", "auto")
        try:
            cpu_budget = capacity if configured == "auto" else int(configured)
        except ValueError as error:
            raise ValueError("OTC_CPU_BUDGET must be auto or a positive integer") from error
    if type(cpu_budget) is not int or cpu_budget < 1:
        raise ValueError("cpu_budget must be a positive integer")
    budget = min(capacity, cpu_budget)
    concurrent = min(camera_count, camera_workers, budget)
    # Each inline camera worker can analyze one frame itself; extra capacity
    # becomes frame workers. Reuse a camera slot's budget for queued cameras.
    shares = [budget // concurrent + (slot < budget % concurrent)
              for slot in range(concurrent)]
    return concurrent, shares
