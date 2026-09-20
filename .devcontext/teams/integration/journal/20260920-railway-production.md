# Railway production deployment
Date: 2026-09-20. Owner: integration captain. Baseline main cdf0049, clean and pushed. User requests Railway deployment with step-by-step instructions, then explicitly selects htnlive.nicholasching.ca for production and reserves htn.nicholasching.ca for the local development reverse proxy.

Project: 74a8b8f8-48eb-45de-9070-9b2643b5f423. The available browser initially shows Login / 404; access is not yet established. No Railway/DNS mutation has been performed. Asked the user to sign in or choose to follow setup instructions themselves; saved-show migration preference remains pending.

Plan: provide a Docker image with pinned Bun and Python dependencies plus Node for Next, one supervised production launcher and one persistent volume, explicit Railway settings and DNS instructions. Validate production startup, authenticated control, participant joins/WebSocket clock, assets and persistence using isolated data/ports; verify the Linux image through Railway build because this Windows machine has neither Docker nor a WSL distribution installed. Keep the current local application/tunnel running.

Repository scope: root Docker/build/start scripts, deployment documentation and integration context. Shared wire contracts and detector implementation are unchanged. Use one replica; do not introduce a distributed-state architecture for this deployment. Never copy ignored .env, live checkpoints, uploaded media or beatsync-source into the image. A requested show migration uses the app's authenticated upload/save API after the destination is verified; do not copy device credentials or raw audience recordings by default.

Official Railway docs inspected: Dockerfile autodetection, volumes, public/custom domains, healthchecks, CLI. Current docs deprecate railway.toml/json config-as-code for new services in favor of their newer IaC; use the root Dockerfile plus explicit dashboard settings for this first deployment. Secret entry and account/billing steps remain user-owned if access requires them.

## Preparation and local checks

User signed in successfully to Resonance/production (environment a24accff-0d18-4b31-844e-cc893fb3099f). Created a staged app service be39636a-6018-4701-a1ef-7a03ec800bd5; its displayed name is invigorating-kindness and source is nicholasching/HackTheNorth main. Staged /api/health, PORT=3000, NODE_ENV=production, SESSION_ID=prod-session, DATA_DIR=/data, production ALLOWED_ORIGINS and OTC_CPU_BUDGET=22. Dashboard displays 24-vCPU/24-GB limits. User entered OPERATOR_SECRET directly and explicitly approved copying the existing saved show/audio. Added a volume mounted at /data. No credential value was read or logged.

The first variable import did not update state through the generic AX setter. Reopened the editor, filled its textbox through the documented browser API, verified the visible content before submit and confirmed six variables staged, then seven after the user's credential addition. No duplicate service was created.

Implemented source-only Docker context, Linux runtime dependencies, frozen Bun/Python installs and production build/start. Launcher isolates all durable paths under DATA_DIR, rejects missing/demo credentials and colliding/non-loopback internal ports, supervises children and stops the deployment if an application exits.

Root gate:sync passed (240 tests, 2,723 assertions plus contract/fixture/boundary/type/lint checks and backend build). Initial typecheck identified Next's augmented ProcessEnv requiring NODE_ENV in the configuration test input; changed the helper's input type to a plain environment dictionary because the helper itself sets NODE_ENV=production. No behavior assertion weakened.

Built both frontends and backend in ignored runtime/railway-production-20260920 with isolated loopback rewrites; initial build lacked backend workspace dependency links, corrected only the disposable copy. New tools/deploy/smoke.ts passed all production pages, protected operator API, participant join and WebSocket clock proxy, a valid synthetic WAV upload, four-section show save and full supervisor restart: show/track hashes/device identity persisted, server epoch changed and playback stayed stopped. The first HTML check incorrectly expected CSS-uppercase text; corrected it to the actual document title. All smoke processes stopped. Final root typecheck and lint pass with the smoke runner included. Logs are build.log / smoke.log in that ignored folder and runtime/branch-restart-20260920/railway-gate-sync.log.

Linux image build/deployment, public HTTPS/WS, custom DNS and approved show migration remain pending. No local dev server, tunnel, checkpoint or uploaded original file was changed.

## First Railway attempt
The user applied the staged deployment before the prepared Docker/start files were pushed. Deployment 41d0857e-7357-4856-ac05-b31d19b6126d used baseline cdf0049 with Railpack and failed during preparation: No start command detected. Confirmed directly in Railway build details; no application process started. Service is now in US East with one replica. Publishing the validated Docker/start files resolves this missing deployment entrypoint; Linux build remains to verify.
