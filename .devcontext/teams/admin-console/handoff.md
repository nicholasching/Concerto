# admin-console handoff

Latest integrated-main mapping update (2026-09-19): camera geometry now works from saved previews, with stage-facing approximate presets and dirty-geometry commit protection. Maps show labeled dots and explicit column-only fallback devices; Assign supports click/box/lasso plus movable left/center/right dividers. Final admin gate passes 24 tests and production build. Four physical-file devices were mapped and committed locally, then selected with a verified 2/1/1 region split. Read the [current integration journal](../integration/journal/20260919-seat-map-selection.md) and [operator guide](../../../docs/audience-mapping.md). The branch-era scaffold/integration instructions below are historical.

Read [stage brief](../../stages/04-admin-console.md), root rules/masterplan, [subplot](subplot.md)
and [plan.md](../../../plan.md) before changing code.

1. Use feat/admin-console, install frozen dependencies (`bun install`), run `bun run gate:admin`.
2. Run the interactive console: `bun run dev:admin-demo`, then open http://localhost:3001.
3. The console talks only to `admin-frontend/src/lib/adapter.ts`. The fake-input harness is
   `tools/admin-demo/server.ts` (no real files needed; uploads are synthetic).

## Implemented behavior (this handoff)

- **Selection** (`packages/selection/src/index.ts`): pure rectangle and polygon geometry. Returns
  explicit device IDs + mapRevision. Inclusive borders; audience-left orientation; coarse/unseen
  excluded; 1,500 points < 100ms. Tests in `packages/selection/tests/selection.test.ts`.
- **Adapter** (`admin-frontend/src/lib/adapter.ts`): the only server interface. Every fetch goes
  through `safeFetch`, so a missing server becomes `AdapterError(SERVER_UNREACHABLE)` with message
  "Real server not detected at <url>". Tracks pending vs confirmed; surfaces server errors
  honestly; rejects stale-map assignments as STALE_MAP. Tests in `admin-frontend/tests/adapter.test.ts`.
- **Fake-input harness: REMOVED.** The console talks to the real control server (Team 1, port
  8080) only. `tools/admin-demo/server.ts` is deleted. `tools/admin-demo/index.ts` is now a
  standalone real-server status checker.
- **UI** (`admin-frontend/src/app/page.tsx` + `src/components/`): Session, Calibration, Review,
  Assign, Perform. When the real server is down, a "Real server not detected" banner shows and
  each tab/action surfaces the same clean error on click. Calibration slots take a real video file
  (`accept="video/*"`). No synthetic data, no fake success.
- **Clock** (`admin-frontend/src/lib/clock.ts`): reads `snapshot.serverMs` for offset; not a second
  estimator. Swap to `SynchronizedClock.toLocalPerformanceMs` when Team 1 ships the sync clock.

## Verification

- `bun run gate:admin` passes (typecheck, lint, contracts, 13 tests, production build).
- Adapter tests verify the not-detected path against a dead port (no harness needed). Selection
  tests cover geometry/orientation/1500-point cost.
- Verified live: console at :3001, 18084 free (harness gone), 8080 down, adapter returns
  `SERVER_UNREACHABLE / Real server not detected at http://localhost:8080`.
- No live-data or physical evidence yet (by design). Real phones/cameras/venue are producer-owned.

## Changed interfaces/files

- New: `packages/selection/tests/selection.test.ts`, `admin-frontend/src/lib/{adapter,clock,useSnapshot}.ts`,
  `admin-frontend/src/components/{MapPanel,CalibrationPanel,AssignPanel,PerformPanel}.tsx`,
  `admin-frontend/tests/{adapter,walkthrough}.test.ts`, `tools/admin-demo/server.ts`, `plan.md`,
  `subplot.md`, this journal directory.
- Modified: `packages/selection/src/index.ts`, `tools/admin-demo/{index.ts,README.md}`,
  `admin-frontend/{package.json, src/app/{page.tsx,globals.css}}`, `bun.lock`.

## Blockers and owning team

- Lockfile changed (admin-frontend now depends on @orchestra/selection) — captain review before merge.
- Real-server adapter wiring needs Team 1's authoritative API.
- Shared-clock estimator needs Team 1's `packages/sync` lifecycle.

## Exact next action

Open http://localhost:3001 after `bun run dev:admin-demo` to drive the walkthrough by hand. Then
wire the real server behind `adapter.ts` (same shapes) and swap `clock.ts` to the sync clock.
