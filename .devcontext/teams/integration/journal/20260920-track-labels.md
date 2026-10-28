# Rename musical lanes

Owner: integration captain on merged `main`, baseline `53dcdddac3ca6b566fa2dfc13449833779aec07d`; clean starting worktree. `foundation-v1`: `ab59c27105627977ee52dc2bcd4276b4532b9e2a`.

User mapping: Percussion → Vocals Left; Percussion 2 → Vocals Right; Vocals → Percussion. Treat this as simultaneous label replacement, retaining lane IDs/order/colors, audio, clips and section routing. Melody is unchanged.

Scope: captain defaults/generated fixtures and current docs, admin fourth-lane action, compatibility of name-based routing in contracts/backend. This is a small integrated-main assignment across the already merged teams; no parallel implementation owners are active. Wire schemas and the reference source remain unchanged.

Plan: update labels and fourth-lane copy; preserve legacy and renamed fallback routes; regenerate fixtures and update existing assertions; run focused sync/client/admin gates from the root. Inspect the saved local show and preserve all content except lane labels and its revision. Record checks and handoff here.

Initial inspection: backend port 8080 refuses connections; no listener exists on 8080/3000/3001. Earlier journal claims of a running show are historical. Name-based default routing currently depends on Vocals/Percussion, so simply replacing display strings would silence centers and move the right-section audio. The compatibility update must retain the same channel IDs for both label sets.

Verification planned: existing routing/draft/snapshot tests, fixture generation/drift checks, root `gate:sync`, `gate:client`, `gate:admin`. Physical phone/audio checks are outside this label change and are not claimed.

## Implementation and checks

- Defaults, editor action/copy, generated show/snapshot/message fixtures, seed/E2E descriptions and current operator documentation use Melody, Percussion, Vocals Left, Vocals Right. Historical ADRs/journals retain their original names.
- The shared resolver preserves the original fallback lanes for old three/four-lane shows and renamed shows. Review also identified a mixed case: adding Vocals Right to an older three-lane show must keep Vocals/Percussion routing. Legacy Vocals takes precedence in that case. Backend manual-column fallback shares this resolver; explicit presets and peer assignments keep their existing behavior.
- Focused five-file suite passed: 45 tests, 184 assertions. After extending mixed/legacy compatibility, the two routing suites passed 17 tests / 91 assertions. No failing test was suppressed.
- `fixtures:generate` regenerated only four JSON fixtures; tone bytes, hashes and optical fixtures remain unchanged. Schema, fixture and reference-boundary drift checks pass.
- Final root gates all passed after the compatibility refinement: `gate:sync` 240 tests / 2726 assertions, `gate:client` 161 tests, `gate:admin` 27 tests, each with 19 contract tests, typecheck/lint and its build. Both frontend bundles include the final resolver. Commands used the bundled `.tools/bun-1.3.14/bun-windows-x64/bun.exe` from the repository root.
- Logs: ignored `runtime/track-labels-checks/gate-*.log`. `git diff --check` passed. No physical sound/browser rehearsal or deployment is claimed for this rename.

## Saved local show

The dev launcher uses `runtime/local/checkpoint.json`, even when `CHECKPOINT_PATH` is absent from the shell. The default `runtime/checkpoint.json` does not exist; the previous server/process descriptions in old handoffs are stale.

Verified again that 3000/3001/8080 have no listeners. Backed up the validated checkpoint to ignored `runtime/track-labels-checks/checkpoint-before.json`, checked that the original had not changed, and saved via `CheckpointStore`'s atomic writer. Revision **6 → 7** applies the simultaneous mapping to the existing channel IDs. A readback/deep comparison proves every other checkpoint field is identical, including all three uploaded tracks/clips, colors/gains, saved section presets, device identities, assignments and map. Restoring the show through `SessionState` succeeds and both explicit and default routing are identical. Uploaded filename labels remain intact.

Local-only verification script: `runtime/track-labels-checks/rename-local-show.ts`; it intentionally requires the old label set and must not be rerun against the already renamed show. No services were started, reset or restarted, and no remote show was changed.

Handoff: start the local app normally with `bun run dev:all`; its saved show will load the new names. No additional audio uploads or routing edits are required. Source/fixture changes are ready for the normal commit/release workflow; no wire/schema migration or reference-source update is needed. No blockers remain for this rename.
