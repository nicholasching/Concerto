# Share the available CPU budget across frame analysis

Date / owner: 2026-09-20, integration captain. Status: implemented and locally verified under the user's performance assignment; deployed Railway throughput remains unmeasured. Detection and room-mapping accuracy remain teammates' separate assignments.

## Decision

Keep independent camera workers, but distribute each camera's frame detection over spawned processes using bounded shared RGB buffers. Consume results in original PTS order before tracking. Never split a temporal code into independently decoded fragments, lower resolution, drop frames, or weaken acceptance to improve timing. Camera geometry and protocol schemas do not change.

One `OTC_CPU_BUDGET` applies to the whole job, rather than a full pool per camera. Its default is the process's detected usable CPUs, capped by affinity and Linux cgroup quota. An explicit positive integer caps that allocation. At 24 available CPUs, one/two/three cameras receive 24/12/8 frame workers per camera. With less capacity than cameras, queue the remaining cameras. `--workers 1` remains a serial reference; an explicit `--cpu-budget` can request parallel frames while processing cameras sequentially.

RawArray provides shared backing storage on Windows and Linux without pickling full-resolution frames through pipes. Allocate a fixed number of frame slots, consume each result before reusing its slot, and retain only existing decoder/preview buffers. Camera parents own and reap their frame children. A frame child also exits when its parent's pipe closes. Existing forced backend cancellation still terminates the entire worker process tree.

The existing distance test in `associate` is evaluated before the expensive footprint calculations it already guards. Its condition and all following rules remain identical. This narrow performance change and the `scan_camera` scheduling adapter are the only edits inside `tracking.py`; `detect_screens`, packet decoding and geometry stay owned by the accuracy workstreams.

## Consequences and verification

More processes use additional RAM. Detection can scale while stateful tracking, decode/output overhead and memory bandwidth eventually limit throughput. Railway's 24-vCPU limit is capacity, not a measured 24× acceleration. Compare identical original inputs and exact semantic results, benchmark serial and parallel runs sequentially, and report physical-file measurements separately from synthetic density and undeployed Railway projections.

See [implementation journal](../teams/otc-localization/journal/20260920-frame-parallelism.md) and [operator/performance guide](../../docs/otc-performance.md). No shared wire changes or additional dependencies are needed; the current backend automatically uses the new worker for subsequent jobs.
