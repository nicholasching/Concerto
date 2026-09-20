# OTC processing and CPU allocation

The worker can analyze different frames of the same video in parallel. It shares a fixed ring of RGB frame buffers between spawned processes and returns only detections over IPC. Tracking still consumes every frame in presentation-timestamp order. Detector thresholds, packet decisions, camera coordinates and geometry are unchanged. The existing distance rejection runs before unused footprint calculations, and the two video-codec threads can decode across frames as well as within a frame.

## Railway and local configuration

No extra service or dependency is needed. The existing Python worker CLI automatically reads the usable CPU count, affinity and Linux cgroup CPU quota, then divides a single analysis budget across the supplied cameras. At a detected 24-CPU allocation, one camera gets 24 frame workers, two get 12 each, and three get eight each. Camera workers coordinate decoding and tracking as well; the analysis budget is not a hard operating-system thread limit.

Set the backend service variable `OTC_CPU_BUDGET=24` to request a ceiling of 24 analysis CPUs, or leave it unset / `auto` to follow the detected allocation. A smaller actual container allocation caps the request. Use a lower ceiling when the backend and frontends need more CPU headroom. New processing jobs read the setting; restart the service to propagate changed deployment environment variables. Existing jobs keep their configuration.

The production Docker image sets `OPENBLAS_NUM_THREADS=1`, `OMP_NUM_THREADS=1` and `MKL_NUM_THREADS=1` before Python starts. Keep these caps when running many frame processes: on Railway, importing NumPy and OpenCV created 95 native threads in each process even after OpenCV was capped, exhausting the container's 1,000-task limit with a 22-worker job. These settings cap nested native pools; `OTC_CPU_BUDGET` still controls parallel frame analysis.

Railway's service resource limit must also permit the desired CPU and memory allocation. An "up to 24 vCPU" plan limit does not establish application throughput; measure the same recordings on the deployed service. See [Railway scaling](https://docs.railway.com/deployments/scaling).

The buffer count is bounded by the configured worker count, independent of video length. Each 4K RGB frame is about 24 MiB; 24 slots use about 570 MiB for frame storage, plus codec/preview buffers, process heaps and detector scratch memory. Total memory is larger and must be measured. Shared storage uses Python's RawArray rather than requiring an enlarged container `/dev/shm` mount. No downsampling, frame dropping, or shortening of the flash sequence is used.

## Reproduce performance and correctness

On the development Ryzen 7 7840HS laptop (8 physical / 16 logical CPUs), the supplied five-phone 4K recording went from **151.0 s** with the previous implementation to **36.7 s** with eight analysis workers (**4.11× faster**). Sixteen workers took 38.1 s; this input had reached a throughput plateau. All result fields except timing matched the original output exactly. A separate three-camera, 1,500-phone synthetic comparison took **69.0 s at budget 3** versus **38.5 s at budget 16**, with the same optimizations in both runs (**1.79× from extra frame parallelism**). All 1,500 positions matched independent truth. These are sequential local measurements; 24-CPU Railway throughput has not been measured. Raw metrics: [physical clip](../.devcontext/evidence/otc-localization/20260920-physical-cpu-scaling.json), [three-camera fixture](../.devcontext/evidence/otc-localization/20260920-three-camera-cpu-scaling.json).

Run from the repository root, with unrelated heavy jobs stopped. Use new output directories and original saved manifests; this command never submits or commits a live calibration:

```powershell
.\.venv\Scripts\python.exe tools/otc-fixtures/compare_performance.py --manifest runtime/local/five-phone-frame.manifest.json --evidence physical --output-dir runtime/otc-cpu-comparison --cpu-budgets 1 4 8 16
```

Linux interpreter: `.venv/bin/python`. The output records wall time, input hashes, effective allocation, exact result equality excluding `processingMs`, and sampled process-tree resident memory on Windows. Shared pages can be counted more than once in that memory sum. Use `--debug` to include review artifact generation. Use `--reference-result path/to/result.json` to compare against a saved result from the previous implementation. The tool fails if any observations, coordinates, diagnostics or warnings differ.

For three-camera recordings, budget 3 reproduces one analysis core per camera. Compare it to 6/12/24; budget 1 also serializes the cameras, so that is a different baseline. `--workers 1` on the worker CLI remains the completely serial reference unless an explicit `--cpu-budget` is supplied. The existing synthetic accuracy benchmark also accepts `--cpu-budget`.

Measurements and limitations are recorded in the [performance journal](../.devcontext/teams/otc-localization/journal/20260920-frame-parallelism.md). Upload time, camera recording time and network latency are not accelerated by CPU parallelism. Tracking, packet aggregation and final mapping place a ceiling on scaling; more workers can stop helping once they become the bottleneck.
