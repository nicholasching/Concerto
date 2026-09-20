# Activate new-detection-algo-full live server

Date: 2026-09-20. User explicitly requested stopping the current app, checking out the co-developer branch, and restarting the live server.
Baseline: clean main at 3ea56f3; fetched origin/new-detection-algo-full at 5494a32. No implementation changes assigned or made.
Plan/checks: stop the verified app supervisor tree; switch branch; preserve runtime/local checkpoint and uploads; start existing dev:all launcher; verify backend/frontends and public connectivity, then run root OTC gate.
Stopped supervisor 20772 and its descendants; unrelated services were untouched. Switched successfully to local tracking branch new-detection-algo-full. An initial journal lookup used integration instead of otc-localization; corrected using rg.
Saved checkpoint copy and new server logs in ignored runtime/branch-restart-20260920. Startup and verification in progress. No seeding, resets, map commits or physical phone tests.

## Live verification
- App launcher PID 40528 runs scripts/dev.ts all, with backend and both Next servers ready. New server epoch e7d52e86-10b1-4fe3-94b7-c9a8988f541a.
- Backend health, audience health/page and proxied /admin all returned HTTP 200. Public https://htn.nicholasching.ca/api/health returned 200; public/local session metadata have the same new epoch, proving the public route reaches this restarted backend. No tunnel change was needed.
- The installed Python worker resolves from this checkout and its production scanner is otc.boxing.scan_phone_detection_camera.
- Saved show, map, assignments, manual routing and run-tag counters are unchanged against the pre-start checkpoint copy. Original device IDs 0, 1, 2 remain; live activity registered another device after restart (next ID 3 to 4). This verification did not issue joins or mutate the session.
- Both saved show assets respond HTTP 200 to HEAD through the audience proxy. Initial stale-page asset 404s in startup logs did not persist in this check.
- Root OTC gate passed contract/fixture/boundary/typecheck/lint/contract-test checks and Ruff; Python suite remains running. No physical recognition/tracking or acoustic verification was performed.

## Final check limitation and handoff
The Python gate reached 72 passing tests (41%) but then stopped reporting progress. Spawned camera/frame worker children persisted for several minutes with under one second CPU each; the full gate appeared stalled in Windows multiprocessing. Stopped only verified pytest process 26724 and descendants. The full OTC gate is incomplete, not passed; this task did not diagnose or modify the co-developer implementation. Earlier checks passed as recorded above. No physical recognition claim.
The live app remains running at new-detection-algo-full / 5494a32. Use https://htn.nicholasching.ca/admin or http://localhost:3000/admin and refresh participating phones before a fresh calibration. Logs: runtime/branch-restart-20260920/. Only this operational journal was added; reference tree and implementation are unchanged. Investigate the full worker gate stall separately if validating the algorithm beyond this server activation.
After termination, buffered gate output additionally flushed `.....FF..F...FF..` after the runner error. No pytest failure summaries were produced, so those failure markers cannot be diagnosed here or distinguished from effects of terminating worker children. Treat full worker validation as unresolved; the earlier 72-dot progress line is not an all-tests-pass claim. Gate exited 1 following deliberate termination.

## Merge authorization
The user confirmed the live branch works and explicitly requested merging the current state to main and committing/pushing. Fresh fetch found no new origin/main or origin/new-detection-algo-full commits beyond the inspected local tips. The only working-tree addition is this operational journal. Preserve the existing full-gate limitation above; user acceptance is separate evidence, not a claim that the worker suite passed. Commit this journal, merge the complete branch to main, push main, and verify remote SHA plus public health. No implementation edits or additional server restart are required.
