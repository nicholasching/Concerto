# Audience Orchestra

An integrated local concert app: audience phones preload audio, synchronize clocks, flash an optical identity, and play the channel assigned by the operator.

All four development branches are merged into `main`. Start with `AGENTS.md`, `rules.md`, `masterplan.md`, and `.devcontext/README.md` for ownership and evidence. Local software integration is implemented; physical phone/camera/acoustic and venue acceptance remain separate. Railway deployment is deferred until after local review.

## Run the local concert

After setup below, run these in separate terminals from the repository root:

```sh
bun run dev:all
bun run demo:seed
```

Open [the operator console](http://localhost:3000/admin) and enter the `OPERATOR_SECRET` from your ignored `.env` (`local-demo-only` is only the unconfigured development default). All pages now share port 3000: [audience](http://localhost:3000/), [projector](http://localhost:3000/present), and [camera uploads](http://localhost:3000/upload). Shows use **Melody, Vocals and Percussion**. `demo:seed` uploads three original eight-second tones and refuses to overwrite an existing show. See the [stage operator guide](docs/stage-dashboard.md).

1. Audience phones join, synchronize and verify assets automatically. They turn their volume up and wait. Sound starts automatically where the browser allows it; otherwise one **Tap to enable sound** action appears. After calibration, phones display their section; unlocated phones get three manual section buttons. Manual locations remain coarse.
2. In **Performance**, select **Prepare cue**, inspect ready/excluded counts, then **Start show**. Stop, pause, seek, gain, mute/solo and the persistent **MUTE ALL** use the real server. Live reassignment verifies readiness for the new channel before scheduling it.
3. For optical localization, keep participating pages visible; open **Calibration**, prepare, start three camera recordings, then arm. Leave recording margin around the 11.75-second pattern (250 ms symbols, no optical run tag). Upload each original clip, specify column/rotation and four ordered seating anchors (or accept a coarse result), process, review annotated stills and unresolved IDs, then commit the map. For a one-camera test, select only that upload with **Include Camera**; use each original recording once. The review distinguishes decoded devices, seat coordinates and column-only results.
4. Use rectangle/lasso selection for localized phones, or explicit IDs/manual columns for unresolved phones. Geometry corrections require processing and review again. A generated video must be labeled **synthetic**.
5. Replace the tones through **Perform → Prepare show and stems**. Edit clip start/source offset/duration/gain while stopped; save the show before preparing playback. The shared 512 MiB decoded budget is per phone; browser and temporary decoding memory are additional, so rehearse large shows on the intended phones. Cue markers persist with the show; waveforms are computed only in the console.

Local state and media live under ignored `runtime/local/`. Restart restores identities, show, map, run-tag allocation and routing, starts a fresh clock epoch, and stays stopped. An unfinished calibration must be repeated after restart. To start a separate concert, set a new `SESSION_ID` and separate `CHECKPOINT_PATH` rather than deleting the existing concert.

For other devices, follow [Cloudflare Tunnel setup](docs/cloudflare-tunnel.md). The single tunnel targets port 3000 and serves `/`, `/admin`, `/present` and `/upload`. Open `/present` on the public hostname to show its audience QR, or set `NEXT_PUBLIC_PARTICIPANT_URL` before starting/building. Operator actions remain password protected; phone uploads use a limited camera token and verified 8 MiB chunks. Railway setup remains a separate milestone.

## Setup

Prerequisites: **Node.js 22+**, **Bun 1.3.14** and **Python 3.13** (worker supports Python 3.11+). The locked Python environment includes PyAV, OpenCV, NumPy and the actual decoder. Do not install dependencies inside `beatsync-source/`.

Install Bun 1.3.14 using your version manager or `npm install -g bun@1.3.14`, then run from the repository root. Node runs the Next servers; Bun runs the backend and tooling:

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

- `dev:sync-demo`: real backend on 8080, with local demo credentials/data defaults.
- `dev:client-demo`: independent participant development harness on 18081; explicitly synthetic, not the integrated concert.
- `dev:admin-demo`: console on 3001, using the real backend on 8080.
- `otc:validate`: validates the shared processing manifest shape and ID invariants. It does not check/decode video files.
- `otc:replay`: explicitly replays a synthetic JSON result into ignored `runtime/otc/result.json`. The integrated server instead spawns the real `python -m otc process` decoder.
- `dev:all`: starts the backend and both real frontends together.
- `test:e2e`: isolated backend, four WebSocket participants, three generated MP4s processed by the real worker, map/selection/routing/transport/mix/panic/restart assertions. Audio output is a recording double; browser verification is separate.
- `test:load`: isolated backend, 1,500 sockets for five minutes with streamed uploads and a synthetic CPU-contention worker. Fails on delivery, reconnect, worker or routing errors. Does not measure real phone or venue capacity.
- `test:smoke`: starts the **built** backend/frontends on private test ports and verifies real HTTP responses; run after `bun run build` or `bun run gate`.
- `check:isolation`: copies active sources to ignored `runtime/isolation/`, omits `beatsync-source`, installs frozen dependencies, and runs the complete foundation gate. It retains the isolated test output for inspection.

All servers bind to local development addresses by default. A phone needs a reachable network address, not its own `localhost`; the event deployment and HTTPS/WSS are Team 1's work. Mock harnesses bind to loopback and are not an event backend. Development mock mode is disabled in production frontend builds.

## Shared interfaces

`packages/contracts/src/` authors the v1 wire shapes. `packages/contracts/generated/schemas.json` is generated JSON Schema for Python; generated OTC files contain the complete 2,048-ID codebook and packet vectors. Clock estimation and audio scheduling are selectively extracted with MIT attribution; the reference tree remains unchanged and is unnecessary at runtime.

```sh
bun run contracts:generate
bun run fixtures:generate
bun run test:contracts
```

Generators are captain-owned. Read `.devcontext/schema/` for boundaries and `.devcontext/beat-sync-extraction.md` for source provenance. `gate` runs all four software gates and builds; `test:e2e`, `test:load`, `test:smoke`, and `check:isolation` provide separate integration evidence. Physical acceptance is recorded separately.

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
