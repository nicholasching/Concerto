# Audience Orchestra

Repository foundation for turning an audience into a synchronized, spatially assigned set of phone speakers.

Start with this README, `AGENTS.md`, `rules.md`, and the **team handoff** at the top of `masterplan.md`. The foundation supplies executable contracts, fixtures, application shells, and independent gates. Concert features and physical validation belong to the four teams; the shells do not claim to implement them.

## Setup

Prerequisites: **Bun 1.3.14** and **Python 3.13** (worker package supports Python 3.11+; the foundation is tested with 3.13). FFmpeg/OpenCV are not required for fixture validation; Team 3 adds and pins the actual video toolchain. Do not install dependencies inside `beatsync-source/`.

Install Bun 1.3.14 using your version manager or `npm install -g bun@1.3.14`, then run from the repository root:

```sh
bun install --frozen-lockfile
bun run setup:python
bun run gate
```

`setup:python` creates a repository-local `.venv` and installs the locked worker development dependencies. On Windows it uses `python`; elsewhere `python3`. Set `PYTHON` to a specific interpreter path if needed. The other three teams can start with their JS gate without installing Python.

For the current Windows preparation machine only, Bun was downloaded into ignored `.tools/bun-1.3.14/bun-windows-x64/`. If Bun is not on PATH, run `& '.\.tools\bun-1.3.14\bun-windows-x64\bun.exe' run gate` in PowerShell or add that directory to the current terminal's PATH. This machine-specific download is not part of the shared repository.

## Choose one team

| Team | Branch | Main ownership | Run independently | Verify | Starting brief |
| --- | --- | --- | --- | --- | --- |
| 1 Sync/control | `feat/sync-control` | `backend/`, `packages/sync/`, `tools/load/` | `bun run dev:sync-demo` | `bun run gate:sync` | [.devcontext/stages/01-sync-control.md](.devcontext/stages/01-sync-control.md) |
| 2 Audio/client | `feat/audio-client` | `client-frontend/`, `packages/audio/`, `tools/client-demo/` | `bun run dev:client-demo` | `bun run gate:client` | [.devcontext/stages/02-audio-client.md](.devcontext/stages/02-audio-client.md) |
| 3 Optical localization | `feat/otc-localization` | `workers/otc/`, `tools/otc-fixtures/` | `bun run otc:validate` then `bun run otc:replay` | `bun run gate:otc` | [.devcontext/stages/03-otc-localization.md](.devcontext/stages/03-otc-localization.md) |
| 4 Admin console | `feat/admin-console` | `admin-frontend/`, `packages/selection/`, `tools/admin-demo/` | `bun run dev:admin-demo` | `bun run gate:admin` | [.devcontext/stages/04-admin-console.md](.devcontext/stages/04-admin-console.md) |

Each brief includes a ready-to-copy agent assignment, the first useful change, existing versus missing behavior, and acceptance criteria. Read your team's `status.md` and `handoff.md` under `.devcontext/teams/` before editing.

Shared `packages/contracts/`, `packages/testkit/`, root configuration/lockfiles, scripts, and CI belong to the integration captain. Team 1's human lead is the default captain; assign the four human lead names before work starts. Do not start by refactoring shared contracts or rebuilding the scaffold.

## Local behavior

- `dev:sync-demo`: backend health/foundation metadata at `http://localhost:8080/api/health`. Concert API routes return typed HTTP 501 responses until Team 1 implements them.
- `dev:client-demo`: audience shell at `http://localhost:3000` plus a **synthetic** HTTP/WS harness on `18081`.
- `dev:admin-demo`: admin shell at `http://localhost:3001` plus a **synthetic** 1,500-device harness on `18084`. This is not a 1,500-socket capacity test.
- `otc:validate`: validates the shared processing manifest shape and ID invariants. It does not check/decode video files.
- `otc:replay`: explicitly replays a synthetic result into ignored `runtime/otc/result.json`. Real `python -m otc process` intentionally exits nonzero until Team 3 implements it.
- `dev:all`: starts the three real application shells together; it does not substitute a mock backend.
- `test:smoke`: starts the **built** backend/frontends on private test ports and verifies real HTTP responses; run after `bun run build` or `bun run gate`.
- `check:isolation`: copies active sources to ignored `runtime/isolation/`, omits `beatsync-source`, installs frozen dependencies, and runs the complete foundation gate. It retains the isolated test output for inspection.

All servers bind to local development addresses by default. A phone needs a reachable network address, not its own `localhost`; the event deployment and HTTPS/WSS are Team 1's work. Mock harnesses bind to loopback and are not an event backend. Development mock mode is disabled in production frontend builds.

## Shared interfaces

`packages/contracts/src/` authors the v1 wire shapes. `packages/contracts/generated/schemas.json` is generated JSON Schema for Python; generated OTC files contain the complete 2,048-ID codebook and packet vectors. The only BeatSync extraction performed by the foundation is the small `epochNow()` function in `packages/sync/`; NTP lifecycle and the audio engine remain assigned work.

```sh
bun run contracts:generate
bun run fixtures:generate
bun run test:contracts
```

Generators are captain-owned. They must not be used to redefine a protocol or rewrite expected outputs just to make a failing test pass. Read `.devcontext/schema/` for the HTTP/WS/worker boundaries and `.devcontext/beat-sync-extraction.md` for source provenance. Full concert integration/load/camera/audio tests are listed in the master plan and stage briefs; current gates verify the foundation only.

## Branch handoff

All four local feature branches start at the tested `foundation-v1` tag. Work in separate clones or worktrees. In this repository:

```sh
git switch feat/audio-client
```

Once the captain publishes the baseline to the existing GitHub remote, teammates can fetch and select their branch:

```sh
git fetch origin --tags
git switch --track origin/feat/audio-client
```

Publishing is a separate action from local scaffolding. The captain's explicit publish command is:

```sh
git push origin main foundation-v1 feat/sync-control feat/audio-client feat/otc-localization feat/admin-console
```

Do not reset an existing team branch to the tag after work starts. Merge small tested slices to `main`, and merge updated `main` into team branches without rewriting shared history.
