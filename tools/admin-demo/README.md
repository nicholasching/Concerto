# Operator harness - Team 4

`bun run dev:admin-demo` starts this fake-input harness on port `18084` and the admin console
(Next.js) on port `3001`. The console talks to the harness through the typed adapter in
`admin-frontend/src/lib/adapter.ts`; it never knows this is fake.

## What the harness simulates (all synthetic, no real files)

- **Snapshot** — `GET /api/sessions/demo/snapshot` returns a 1,500-device admin snapshot built
  from the shared fixture. Map evidence is labeled `synthetic`.
- **Calibration** — `POST /api/calibrations`, `.../arm`, `.../uploads`, `.../jobs`. Uploads accept
  a fake file or none; jobs stream fake `JobProgress` (queued → validate → decode → track →
  register → complete over ~2s) and produce a synthetic candidate map.
- **Commit map** — `POST /api/calibrations/:runId/commit-map` commits the candidate and bumps
  `mapRevision`. A stale `expectedMapRevision` returns `409 STALE_MAP`.
- **Assignments / transport / mix** — accepted as pending actions with a future `effectiveServerMs`.
  They apply when the shared clock reaches that time, so the console can show pending vs
  confirmed distinctly. A stale map revision on assignment returns `409 STALE_MAP`.
- **Panic** — clears pending actions, stops transport, mutes all channels.
- **Job progress** — `GET /api/jobs/:jobId`.

## Notes

- `server.ts` exports `startAdminHarness(port, count)` so adapter tests can start a small instance.
- Dot count is not load evidence; this is a loopback single-process harness, not 1,500 sockets.
- Production UI ignores the mock flag; this harness is for building and testing only.
