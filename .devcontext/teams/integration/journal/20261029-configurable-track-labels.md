# Configurable musical lane names

Status: verified for local software. Owner: integration captain for this cross-application user request on merged main; baseline `0f2e04c83120152db4e1957978c97d8bbd85fe0b`, clean working tree. Foundation: `ab59c27105627977ee52dc2bcd4276b4532b9e2a`.

## Goal, assumptions and assignment

The pictured labels are logical channel names, separate from uploaded asset filenames. Add editable names under Performance → Prepare show and stems; save them with the existing show so operator and participant consumers receive authoritative names. Retain IDs, colors, audio, mix and routing. Names are per show and edited while stopped under the existing save restrictions.

Small integrated-main assignment: admin editor/draft helper/tests, backend fallback consumer and show tests if required, operator guide and this context/handoff. No concurrent edits were observed in the clean checkout; no shared schema, generated fixture, root configuration, dependency or reference-tree edits are planned. Existing `Channel.label`/`Show.sectionChannels` carry the feature without a contract migration.

## Plan and success criteria

1. Add name inputs and preserve ID-based presets before any rename. Block blank names; retain recoverable drafts and server-confirmed save semantics.
2. Remove the fourth-lane add affordance's assumption that a renamed fourth lane is absent. Audit label consumers and legacy manual-column fallback for routing loss.
3. Verify renamed drafts/recovery, real authenticated save/snapshots/restart, routing and participant view. Run root `gate:admin`, `gate:sync`, `gate:client` and an isolated real-browser walkthrough. Record physical checks separately.

## Inspection

- Timeline, gain/mute/solo controls, section summaries/options and audience channel text already render saved `Channel.label`.
- Older shows infer section defaults from labels until explicit presets are saved. Capture `sectionChannelsFor(show)` before changing names to retain musical routing.
- The editor checks the fourth lane by its old name, which would incorrectly offer another lane after renaming. Cap this existing addition at four lanes.
- Legacy `participant.column` fallback explicitly strips saved presets before resolving defaults; examine this consumer with renamed-label regression coverage.

Checks and handoff will be appended after implementation. No deployment or physical sound/camera check is included in this local update.

## Implementation checkpoint

- Name fields use the existing stopped-only editor and session-storage recovery. Nonempty names are required for save, and saved names are trimmed. Draft changes update section options locally; other surfaces keep confirmed names until save succeeds.
- `renameChannel` captures existing inferred presets before editing. Explicit silence/shared routes and duplicate display names retain distinct stable channel IDs. The fourth-lane add helper and affordance stop at four channels even when names differ from defaults.
- Integrated consumer fix: legacy three-column fallback now honors saved ID presets before name-derived defaults. Current four-section routing already did so. This avoids silencing old clients after custom names are saved; peer-majority routing retains precedence. No shared schema or generated data changed.
- Initial focused command: bundled Bun `test ./admin-frontend/tests/show-draft.test.ts ./backend/tests/show.test.ts ./backend/tests/manual-routing.test.ts ./backend/tests/automatic-sections.test.ts` — **39 pass, 0 fail, 180 assertions**. Includes a real authenticated PUT, both snapshot roles, durable restart and a newly joining fallback phone.

Next: root gates and isolated browser edit/save/audience verification. No production or saved concert data has been read or modified.

- First admin gate stopped at TypeScript: a new test compared resolved presets to an optionally typed field. Corrected the assertion to compare both resolved preset objects; runtime behavior was already passing. Failure log retained as `runtime/configurable-track-labels-checks/gate-admin-first.log`.

## Final verification and handoff

Status: verified for this local software change; physical rehearsal remains a separate project gate.

- Root commands used `.tools/bun-1.3.14/bun-windows-x64/bun.exe run gate:admin`, `gate:sync`, `gate:client`. All passed, including contract/schema/fixture drift checks, source boundaries, typecheck, lint and the relevant production builds. Admin: **35 focused tests / 103 assertions**; sync: **259 / 4144**; client: **171 / 1251**. Each gate also passed **19 contract tests / 6216 assertions**. Final logs: ignored `runtime/configurable-track-labels-checks/gate-{admin,sync,client}.log`.
- Real browser used production builds on loopback 13010/13011 with the existing real-module `tools/e2e/ui-server.ts` proxy on 18090 and disposable `runtime/ui-test/<uuid>` state. Original synthetic tones only. Test password `test-stage`; no production connection, live checkpoint or uploaded song was used. An initial browser navigation before the services were started returned connection-refused; retry after startup worked.
- Browser checks: whitespace-only name disables Save with an inline error; all four unsaved names recover after reload; confirmed timeline retains previous labels until save; save trims `  Guitar  `; timeline/mix controls and section summaries/options show Guitar/Bass/Drums/Harmony; an already connected Left audience page changes Melody → Guitar without reload; saved names survive operator reload; no extra fourth-lane button appears. The browser reported Ready; no physical audio claim follows from that.
- Visual evidence (ignored): `runtime/configurable-track-labels-checks/name-editor.png` and `audience-renamed.png`. Editor fields and preset options were visually checked for layout. Test services/tabs are stopped/closed after verification.
- Changed implementation: `admin-frontend/src/components/ShowEditor.tsx`, `src/lib/show-draft.ts`, `src/app/globals.css`; `backend/src/state.ts` fallback preset resolution. Regression tests: admin show-draft and backend show suites. Operator usage: `docs/stage-dashboard.md`. No shared interface, schema, fixture, dependency, lockfile or `beatsync-source/` changes.
- Consumer action: run the updated app normally, stop transport, open Performance → Prepare show and stems, edit Track name, Save prepared show. Connected audience clients receive saved labels through the existing show/snapshot flow. Existing audio/routing are retained. Release/deployment is still a separate action; no commit, push, deployment or live show migration was performed.

## Source publication follow-up

The user subsequently requested commit/push of this verified change. Reviewed the complete implementation diff and exact file list; no unrelated work appeared and `git diff --check` passes. Fetched `origin/main`, which matches the baseline exactly (0 ahead / 0 behind). Publish this slice as `feat(admin): configure musical track names` on main. Application/test code is unchanged since the three passing gates and browser checks above; only handoff documentation changed afterward. Deployment and live show edits remain outside this source-publication request.
