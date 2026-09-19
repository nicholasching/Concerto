# admin-console handoff

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
- **Adapter** (`admin-frontend/src/lib/adapter.ts`): the only server interface. Tracks pending vs
  confirmed; surfaces server errors as `AdapterError`; rejects stale-map assignments as STALE_MAP.
  Tests in `admin-frontend/tests/adapter.test.ts`.
- **Harness** (`tools/admin-demo/server.ts`): in-memory deterministic state. Routes: snapshot,
  calibration create/arm/uploads/jobs, job progress, commit-map, assignments, transport, mix,
  panic. Pending actions apply when `effectiveServerMs` is reached. `startAdminHarness(port,count)`
  is exported for tests.
- **UI** (`admin-frontend/src/app/page.tsx` + `src/components/`): Session (counts + QR placeholder
  + panic), Calibration (three fake-camera slots, job progress, commit), Review (read-only map),
  Assign (canvas selection, channel, scheduled change, undo), Perform (four-lane timeline,
  shared-clock playhead, transport, gain/mute/solo, panic).
- **Clock** (`admin-frontend/src/lib/clock.ts`): reads `snapshot.serverMs` for offset; not a second
  estimator. Swap to `SynchronizedClock.toLocalPerformanceMs` when Team 1 ships the sync clock.

## Verification

- `bun run gate:admin` passes (typecheck, lint, contracts, 8 tests, production build).
- `admin-frontend/tests/walkthrough.test.ts` drives the full operator flow end to end against the
  harness and asserts: 1,500-phone snapshot, three uploads, one failed upload keeps the others,
  job completes, map commits (revision bumps), assignment confirms, transport plays then stops,
  panic mutes and clears. Plus a stale-map rejection test.
- This is mock evidence only. Real phones/cameras/venue are producer-owned physical checks.

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
