# Cloudflare device-testing support — 2026-09-19

Status: verified for tunnel software/desktop browser; physical device acceptance outstanding. Captain owns this integration follow-up under the user's request. Baseline: main f2d097d, clean. User wants repository support and setup instructions for testing audience devices through Cloudflare; Railway remains deferred.

## Findings and decision

- The QR defaults to localhost:3000 and the audience browser constructs a separate hostname:8080 API URL. A tunnel for the HTML alone cannot connect phones.
- The installed Next 16.2.7 router supports external rewrites for both HTTP and WebSocket upgrades. Reuse it on port 3000 rather than introducing another proxy process/dependency.
- Only participant routes are forwarded: health/session, joins, participant snapshots, audio downloads and participant WebSockets. Add participant-only backend aliases so even an operator credential supplied to the public audience origin cannot grant the operator role. The console, mutations and camera uploads stay on localhost:3001/8080.
- Audience API/WS defaults use its own origin (HTTPS becomes WSS). Explicit deployment/mock endpoint overrides remain supported. Named tunnel development origins are explicit; the existing trycloudflare.com dev-origin allowlist remains.
- QR links normalize the current session, validate HTTP(S), and persist a saved public URL per session in the local console. Operators can paste a new Quick Tunnel URL without rebuilding either frontend.
- cloudflared is installed (2025.8.1). Provide Quick Tunnel and dashboard-managed named-hostname instructions from current official Cloudflare documentation. Do not create an account, change DNS, or install a persistent system service during this repository task.

## Checks planned

Endpoint/QR URL regressions; participant-only HTTP/WS authorization regressions; focused sync/client/admin gates; actual Next reverse-proxy joins, snapshots, asset hashes and clock probes. Inspect the console in a browser. Keep tunnel transport verification separate from physical phone/audio acceptance.

## Experiment: actual WebSocket upgrade

All three focused gates passed, but the first `check:tunnel` on the Bun-hosted Next dev server timed out before the WebSocket opened. Direct backend sockets opened and replied to probes. The identical audience build under Node 22.14 on port 13002 passed join, snapshot, authorization boundaries, WebSocket clock exchange and audio SHA-256. Launch Next servers with Node (backend/scripts remain Bun); verify the corrected dev launcher before creating the tunnel. Production smoke uses the same Node runtime. This is why HTTP-only startup checks did not suffice.

## Verification completed

- `bun run gate:sync`: PASS, 203 focused tests plus 14 contract tests and backend build.
- `bun run gate:client`: PASS, 116 focused tests plus 14 contract tests and production client build.
- `bun run gate:admin`: PASS, 19 focused tests plus 14 contract tests and production console build. All gates include schema/fixture drift, boundary, type and lint checks. These are 352 distinct JS tests across the three gates (contract suite repeats).
- After the runtime correction: `bun run typecheck`, `bun run lint`, and `bun run test:smoke` PASS. Smoke started the built backend plus both Next frontends under Node on isolated ports.
- `bun run check:tunnel -- http://127.0.0.1:13002`: PASS with the built Next audience server under Node. `bun run check:tunnel` on the corrected `dev:all` server: PASS.
- Started the installed cloudflared 2025.8.1 using `cloudflared tunnel --url http://127.0.0.1:3000`; it registered a QUIC connector. `bun run check:tunnel -- <actual-public-https-origin>` PASS: join, authenticated participant snapshot, blocked operator routes, WSS initial snapshot/clock exchange, first original tone byte count/SHA-256. No account, DNS changes or persistent connector service were created.
- Desktop in-app browser at the public HTTPS origin: Connected, Clock synced (~9 ms displayed uncertainty at inspection), Audio unlocked after user-gesture click, Assets verified 4/4. No channel assigned to the browser test participant; transport remains stopped. This is not phone speaker or onset evidence.
- Console: saved the actual tunnel origin through Participant link / Use participant link, confirmed the session query and QR/link update, reloaded and verified persistence. Inspected the visible QR controls. The tunnel, backend and frontends remain running for user testing; the public URL is temporary and is not a committed configuration value.
- `git diff --check` PASS. No dependencies, lockfiles, shared payload schemas or reference-tree files changed. The temporary Node production server was stopped after verification. The existing local concert was preserved; transport checks allocated test device IDs and disconnected them without changing show/routing.

## Handoff and limits

Use `docs/cloudflare-tunnel.md` for Quick Tunnel and stable named-hostname instructions, environment variables and failure diagnosis. Scan the saved QR from actual phones, tap Enable sound, assign channels and check playback. A new Quick Tunnel URL means a new audience browser origin/identity; paste/save the new URL in the console. Quick Tunnel's 200 in-flight request limit is unsuitable for a 1500-phone capacity claim. No physical phone, camera, acoustic, venue, named-account tunnel or Railway deployment test was performed in this follow-up. Prior full integration/worker/load results remain in their original evidence files.
