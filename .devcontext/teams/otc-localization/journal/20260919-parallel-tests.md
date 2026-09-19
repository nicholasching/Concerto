# Parallel camera regression tests

Date: 2026-09-19. Agent: parallel_tests. Branch: feat/otc-localization. Starting commit: 49328c3a19025b4a389f36d92e012d9aa3829ad7. Foundation: ab59c27105627977ee52dc2bcd4276b4532b9e2a.

## Scope and assumptions

- Own only workers/otc/tests/test_parallel.py and this journal; parent owns implementation and integration documentation.
- User authorized three camera worker processes. Parent API: process_manifest(..., workers=3), with workers=1 as serial reference; CLI defaults to three workers.
- Worker processes do detection/tracking/decoding; progress callbacks and deterministic aggregation run in the parent. Existing wire schemas stay frozen.
- Generated six-device H.264 clips exercise actual decoding without claiming physical-camera evidence. Failed camera jobs must leave no new live child processes or successful CLI result.

## Plan and verification

1. Compare real serial/parallel results, excluding processing time; verify shuffled camera order, parent-only schema-valid progress, distinct child PIDs and debug review artifacts.
2. Inject one invalid video with a matching SHA-256 so failure occurs after hash validation; verify cleanup.
3. Run the real CLI for default parallel success/failure and assert publication semantics.
4. Run `.venv/Scripts/python.exe -m pytest workers/otc/tests/test_parallel.py -q` and targeted Ruff; parent runs the full gate after combining changes.

## Current checkpoint

Read root rules/masterplan/context, Team 3 stage/status/handoff, worker AGENTS and existing pipeline tests. Working tree was clean before parallel work. Production parallel API is being implemented concurrently; tests are prepared against the agreed interface.

## Initial red check

- Four tests added, with one six-phone capture reused within the session. The serial/parallel comparison shuffles manifest camera order and includes final review artifacts.
- Targeted Ruff passed after removing one unused import introduced here.
- `python -m pytest workers/otc/tests/test_parallel.py -q -x`: expected initial failure, `process_manifest() got an unexpected keyword argument 'workers'` (1 failure in 1.75 seconds). Parent production implementation is pending; assertions were retained.

## Green check and added lifecycle regressions

- After the parent implemented camera_worker.py, the original four tests passed in 14.00 seconds. Serial and parallel output matched exactly after omitting only processingMs, including shuffled manifest order and review data.
- Added two requested lifecycle regressions: terminate exactly one matching, newly spawned multiprocessing child when its decode event arrives (simulated abrupt worker exit); and raise from the parent's progress callback (simulated disconnected consumer). Both require cleanup of every newly started child. The termination test excludes pre-existing child PIDs and never targets arbitrary system processes.
- Final focused command: `.venv/Scripts/python.exe -m pytest workers/otc/tests/test_parallel.py -q` → **6 passed in 14.78 seconds**.
- `.venv/Scripts/python.exe -m ruff check workers/otc/tests/test_parallel.py` → all checks passed. `git diff --check` → clean.

## Handoff

Owned changes are complete: six real-MP4 concurrency/lifecycle/CLI tests plus this journal. Tests exercise three distinct camera child PIDs, parent-only monotonic schema-valid progress, deterministic result/debug ordering, handled camera errors, abrupt child death, consumer exceptions, and publication only after success. No production/shared files or dependencies were changed by this agent; no commit was made. Parent runs the combined Team 3 gate and records system performance independently. These tests provide synthetic software evidence, not physical camera or venue validation.
