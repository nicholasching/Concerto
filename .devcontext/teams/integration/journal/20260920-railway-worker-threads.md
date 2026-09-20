# Railway worker process/thread exhaustion

Date: 2026-09-20. Owner: integration captain. Baseline main 338c733. User reports processing failure at 5%: `[Errno 11] Resource temporarily unavailable` (worker exit 2).

Production Docker deployment 3d35314b-18b2-4bea-8ff2-1273501223e5 is healthy in US East; all public pages and `/api/health` return 200, session is prod-session and unauthenticated operator snapshot returns 401. Development remains on htn.nicholasching.ca. Only a journal newline repair was outstanding before this fix.

Inspected the actual container through Railway Console without reading secrets. `/sys/fs/cgroup/pids.max` is 1000, `pids.events` reports `max 116`, and the idle current task count was 91. CPU quota is 24 CPUs and OTC_CPU_BUDGET is 22. OPENBLAS_NUM_THREADS and OMP_NUM_THREADS were unset. In a fresh Python process: before importing NumPy/OpenCV there was one thread; after import there were 95, and `cv2.setNumThreads(1)` still left 95. This explains how the explicit analysis process budget could exceed the independent PID/thread limit.

With OPENBLAS_NUM_THREADS=1, OMP_NUM_THREADS=1 and MKL_NUM_THREADS=1 set before Python starts, the same import plus OpenCV cap leaves one thread. Added these three image environment defaults; analysis worker allocation, resolution, tracking and recognition remain unchanged. No shared protocol change or detector edit is required.

Same-clip verification passed in the actual Railway container: latest failed manifest f644443c-5888-4779-9f20-c970249dd344, original 22-worker budget, all 306 frames through PTS 11966.5 ms, validated result written, exit 0 in 6.4 seconds. Unique output prefix `/tmp/otc-thread-cap-3c5ab9e6-bfc5-4cd5-a57e-b871fe12322a` leaves the app's job and current reviewed map unchanged. Cgroup PID-limit events stayed at 116; the capped rerun incurred no new limit violations. This is processing completion on the user's original clip, not a claim of physical identification accuracy or a committed live map.

Next: publish the Docker configuration and verify the rebuilt deployment's environment and health. Redeployment changes the server epoch, so an unfinished live calibration must be repeated; saved media/show and registered devices persist.
