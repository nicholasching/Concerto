# One public audience origin for local Cloudflare testing

Date: 2026-09-19. Status: accepted by captain under the user's integration request. Affects sync/control, audio/client and console. Protocol payloads remain v1.

The Next audience server on port 3000 proxies an explicit participant API allowlist plus /ws to the internal backend. Same-origin HTTP/WSS avoids public :8080 URLs and additional tunnels. Backend aliases /api/sessions/:sessionId/participant-snapshot and /ws/participant only accept participant credentials; public routing cannot upgrade a request to operator access. Existing local endpoints remain compatible.

The operator uses localhost:3001 and backend:8080, including large original camera uploads. The public QR URL is saved in console browser storage per session, independent of frontend build-time variables. NEXT_PUBLIC_API_URL/NEXT_PUBLIC_WS_URL still support explicit separate deployment endpoints; BACKEND_INTERNAL_URL configures the server-side audience proxy at dev startup/build time.

Next runtime processes use Node 22+; the backend and tooling retain Bun 1.3.14. A real WebSocket experiment found Bun-hosted Next stalled at upgrade on Windows, while the same audience build under Node successfully proxied snapshots, probes and audio. The dev launcher and production smoke explicitly select Node, and `check:tunnel` exercises the network boundary beyond HTML startup.

Quick Tunnels are only for small device tests. Cloudflare currently limits them to 200 in-flight requests; the existing 1500-socket loopback result does not establish tunnel or physical capacity. Stable named tunnel instructions are provided separately. Actual Railway deployment remains a future task.
