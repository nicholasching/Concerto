# Foundation verification - 2026-09-19

Tested state: the working tree committed as `foundation-v1`. Resolve the exact base with `git rev-parse foundation-v1`. Platform: Windows x64, PowerShell, Bun 1.3.14, Node 22.14.0, Python 3.13.15. Bun is task-local under ignored `.tools/`; dependencies and virtual environments are not committed.

## Checks performed

| Check | Observed result |
| --- | --- |
| Frozen Bun install | Passed; 280 dependencies installed |
| Python setup | Passed; locked validation/test dependencies and editable worker |
| `bun run gate` | Passed: schema/fixture determinism, reference/mock boundaries, TypeScript, ESLint, 23 Bun tests, backend bundle, both optimized Next builds, Ruff and 10 pytest tests |
| Final `bun run check:isolation` | Passed all the above from a fresh dependency install in `runtime/isolation/1789795074819`, containing no `beatsync-source/` |
| `bun run test:smoke` | Passed backend and both built frontend HTTP checks on private ports, including the final isolated build |
| `bun run dev:sync-demo` | Started and returned foundation health on 8080 |
| `bun run dev:client-demo` | Started mock 18081 and client 3000; HTTP served explicit synthetic preview |
| `bun run dev:admin-demo` | Started mock 18084 and admin 3001; HTTP served explicit synthetic preview |
| `bun run dev:all` | Started the three real shells; HTTP returned foundation content, with mock mode disabled |
| `bun run otc:validate` | Valid manifest; explicitly reports videoFilesChecked=false |
| `bun run otc:replay` | Wrote a schema-valid explicitly synthetic result under ignored runtime |
| Reference source | `git diff -- beatsync-source` empty; active workspace/build/test/import boundaries exclude it |
| Generated Next declarations | Removed the generated declarations in the isolated copy; both apps regenerated route types successfully and root typecheck passed. These files are ignored to avoid build/dev churn in team branches. |

The full gate executes the common checks plus all four team test/build paths. Individual gate commands select the same paths independently. Bun tests contain 6,194 assertions, including all 2,048 codewords and minimum pairwise distance four. Python tests check schema compatibility, duplicate/run/hash identity, null unknown coordinates and honest failure/replay behavior. The 33 total tests are scaffold/contract checks, not feature coverage.

## Failures found and resolved

- Declared missing root workspace/Zod dependencies under Bun's isolated linker.
- Added TypeScript CSS declarations and corrected discriminated-union narrowing without relaxing strict mode.
- Declared the exact Node type dependency so Next does not attempt an npm auto-install in a Bun workspace.
- Pinned frontend tracing roots after the first nested isolation build inferred the parent workspace. The final source-free build completed without that warning.
- Included future audio/selection package tests in their team gates and current frontend test files in root typechecking.
- Checked all 48 project Markdown files for local links, balanced fences and encoding; checked command names and the five required rule groups.

## Limits

- No real join/control API, NTP estimator, audio engine, flash renderer, video decoder or interactive console has been implemented by the foundation.
- No MP4 decoding, physical phones/cameras, acoustic accuracy, browser interaction automation, load/capacity or venue-network test was performed.
- The 1,500-device map is generated data. HTTP checks establish startup/content, not interactive UI behavior.
- CI configuration is committed but hosted Linux jobs await publication. Local checks were Windows only.
- Unmodified BeatSync runtime characterization and the video dependency/toolchain choice are explicit first team milestones.
- Local branches/tag are the handoff baseline; no remote push or teammate worktree creation is part of this preparation.
