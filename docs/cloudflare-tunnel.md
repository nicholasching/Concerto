# Test audience devices through Cloudflare

Run the app on your computer and give phones a public HTTPS audience URL. Port **3000** is the only Cloudflare origin needed: `/` is the audience, `/admin` is the password-protected command dashboard, `/present` is the projector QR/counts, and `/upload` is the camera-crew uploader. The proxy carries HTTP, media and WebSockets to the backend on 8080 and the admin bundle on 3001. Phones do not need an app, Cloudflare account or access to your Wi-Fi. See the [stage guide](stage-dashboard.md).

## Configured hackathon hostname

Audience: **https://htn.nicholasching.ca/?session=dev-session**. The named tunnel's published route points `htn.nicholasching.ca` to `http://localhost:3000`. This hostname is allowed by both Next development configurations. `NEXT_PUBLIC_PARTICIPANT_URL` supplies the projector's public QR even when opened locally.

On the configured Windows computer, the connector token is in `%LOCALAPPDATA%/AudienceOrchestra/cloudflare/htn.token`, in a directory restricted to the current user, outside Git and OneDrive. The ignored root `.env` sets `TUNNEL_TOKEN_FILE` to that file, `DEV_ALLOWED_ORIGINS=htn.nicholasching.ca`, and `NEXT_PUBLIC_PARTICIPANT_URL=https://htn.nicholasching.ca`. No token is stored in tracked files or supplied as a process argument. Cloudflare supports this file-based credential through [`TUNNEL_TOKEN_FILE` / `--token-file`](https://developers.cloudflare.com/tunnel/reference/run-parameters/#token-file).

The connector is running as a hidden process for this test. After stopping it or rebooting, run the app and named connector in separate terminals:

```powershell
bun run dev:all
```

```powershell
bun run tunnel:named
```

Keep both running during phone testing. Check the connection with `bun run check:tunnel -- https://htn.nicholasching.ca`. On another computer, supply that tunnel's token in a private file outside the repository and set `TUNNEL_TOKEN_FILE` in your ignored root `.env`; the credential is intentionally not distributed through Git. Named-tunnel route/DNS changes belong in the Cloudflare dashboard. A Windows service was not installed.

## Quick Tunnel — simplest for a few devices

1. From the repository root, start the app and leave this terminal open:

   ```powershell
   bun run dev:all
   ```

   If the app is already running, restart it once after pulling these changes. Node.js 22+ and Bun must be available on PATH; the script runs Next with Node to support WebSocket proxy upgrades (both are installed here). If no show exists, run `bun run demo:seed` in another terminal. Do not overwrite an existing show.

2. Check that `cloudflared --version` works. It is already installed on the current development computer. On another machine, use [Cloudflare's official downloads](https://developers.cloudflare.com/tunnel/downloads/); on Windows the executable may be named `cloudflared.exe`.

3. In a second terminal, run:

   ```powershell
   bun run tunnel:quick
   ```

   This executes:

   ```powershell
   cloudflared tunnel --url http://127.0.0.1:3000
   ```

   Copy the **HTTPS** `https://<random-name>.trycloudflare.com` URL printed by cloudflared. Leave the process running. A Quick Tunnel needs no Cloudflare account or domain. Its URL changes when you create a new tunnel. [Official Quick Tunnel instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

4. Open `<public-origin>/present` on the projector. Its QR points to the audience root with the current session. If `NEXT_PUBLIC_PARTICIPANT_URL` is set to a different hostname, update or remove it in `.env` before starting Next (rebuild production after changing it). Open `<public-origin>/admin` and sign in with your configured operator password.

5. Scan the QR from each phone and wait for Connected, In sync and Music verified. If the browser requests it, tap **Tap to enable sound** once. Keep participating pages visible with volume up. Run calibration, upload camera recordings through `<public-origin>/upload`, commit the map and assign musical parts. Unmapped phones can choose their section after calibration completes.

6. Optional transport check from a third terminal:

   ```powershell
   bun run check:tunnel -- https://YOUR-ACTUAL-NAME.trycloudflare.com
   ```

   It verifies a real join, participant snapshot, WebSocket clock round trip and the first loaded audio asset's hash. It checks participant-only socket isolation and unauthorized operator/camera access. It allocates one test device ID and disconnects it; it does not change the show or assignments.

Stop the tunnel with Ctrl+C when finished. Keep the app terminals open during testing. If Bun is absent from PATH on the current Windows machine, substitute `& '.\.tools\bun-1.3.14\bun-windows-x64\bun.exe'` for `bun`.

## Stable hostname through the Cloudflare dashboard

This option requires a Cloudflare account and a domain on Cloudflare.

1. Go to **Networking → Tunnels → Create Tunnel** in the Cloudflare dashboard. Name it, for example `audience-local-test`.
2. Select Windows and the computer's architecture. Follow the displayed **Install and Run** instructions on this computer. The dashboard's connector token is a credential: keep it out of Git and screenshots. A Windows service may require an administrator terminal; the app itself still needs to be running.
3. Once the tunnel is **Healthy**, open **Routes → Add route → Published application**.
4. Set the hostname to your audience subdomain, for example `audience.example.com`. Set **Service URL** to **`http://127.0.0.1:3000`** (HTTP for this local hop). Save the route. Cloudflare supplies public HTTPS/WSS and creates the tunnel DNS route.
5. Allow your actual hostname for Next's development assets. In the terminal that starts the app:

   ```powershell
   $env:DEV_ALLOWED_ORIGINS = 'audience.example.com'
   bun run dev:all
   ```

   Use comma-separated hostnames if needed, without schemes or paths. Quick Tunnel hostnames and `htn.nicholasching.ca` are already allowed. Alternatively put the value in the ignored root `.env`, then restart the app.
6. Open `https://audience.example.com/present` for the QR. For a local projector view, set `NEXT_PUBLIC_PARTICIPANT_URL=https://audience.example.com` in `.env` before starting/building the frontends. Check the tunnel with `bun run check:tunnel -- https://audience.example.com`.

Cloudflare UI names can vary between the account dashboard and Cloudflare One. The equivalent route is a public/published application hostname pointing to the same local HTTP service. [Current Cloudflare dashboard instructions](https://developers.cloudflare.com/tunnel/get-started/).

## Repository settings and routing

| Setting | Purpose |
| --- | --- |
| `BACKEND_INTERNAL_URL` | Next server-side rewrite destination, default `http://127.0.0.1:8080`. Read at dev startup/build time. Never use a public tunnel URL here. |
| `ADMIN_INTERNAL_URL` | Audience server's destination for the `/admin` Next zone; defaults to `http://127.0.0.1:3001`. Read at startup/build time. |
| `DEV_ALLOWED_ORIGINS` | Additional named hostnames for Next dev assets/HMR. `*.trycloudflare.com` is included already. |
| `TUNNEL_TOKEN_FILE` | Private token-file path consumed by `bun run tunnel:named`; use the ignored root `.env`, with the token itself outside the repository. |
| `NEXT_PUBLIC_PARTICIPANT_URL` | Optional projector QR origin; otherwise uses the origin where `/present` was opened. Set before dev startup or production build. |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` | Explicit separate-backend or mock overrides. Leave unset for this tunnel setup so phones use the current HTTPS/WSS origin. |
| `NEXT_PUBLIC_CLOCK_PROFILE` | Participant timing tolerance: `internet` (default, best RTT <=300 ms / clean sample age <=10 s), or `strict` (<=40 ms / <=3.75 s). Restart Next dev or rebuild production after changing. |

Audience API aliases and `/ws` remain participant-only. `/control` carries authenticated operator requests and sockets; `/api/camera` carries limited camera access; `/api/presentation` returns aggregate counts without identities or secrets. `/admin/_next` isolates admin assets from the audience bundle. Keep the tunnel pointed at port 3000. Camera uploads authenticate, transfer and verify one clip in chunks before registering it with the calibration run; the original file ceiling remains 1 GiB.

## Troubleshooting and scope

- **Page opens but cannot join:** remove old `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_WS_URL` values that point to localhost or a public host on port 8080, then restart the app. Test `<public-origin>/api/health`; it should return JSON. A phone's localhost refers to itself.
- **502 from Cloudflare:** confirm `http://127.0.0.1:3000/api/health` works locally and that both the app and cloudflared are running. Check the local Service URL is HTTP, not HTTPS.
- **No styles/HMR on a named domain:** set `DEV_ALLOWED_ORIGINS` to the actual hostname and restart development. This does not add backend CORS exceptions; audience requests use one origin.
- **An updated page still runs old client behavior:** Next development assets now carry a per-server deployment ID and CDN no-store headers. Restart the audience development server and refresh the phone if cached code persists; confirm the new readiness cards. For a named Cloudflare zone, keep cache rules from overriding origin caching for this testing hostname. Production uses its normal versioned assets. [Next deployment IDs](https://nextjs.org/docs/app/api-reference/config/next-config-js/deploymentId).
- **QR still shows an old URL:** update or remove `NEXT_PUBLIC_PARTICIPANT_URL`, restart Next and refresh `/present`. A new Quick Tunnel hostname has separate browser storage, so phones join as new identities.
- **Quick Tunnel refuses to start with a config file present:** Cloudflare documents a conflict with an existing `.cloudflared/config.yaml`. Preserve that file; use the named tunnel it configures or temporarily rename it deliberately before running a Quick Tunnel. Do not overwrite existing tunnel configuration.
- **Phone clock or audio is unready:** keep the page visible, unlock audio and retry preparation after connectivity recovers. Internet routing adds latency; the shared estimator reports readiness rather than pretending every connection is synchronized.
- **All phones disconnect together:** check the host's network and connector log. `unreachable network` or simultaneous tunnel timeouts can follow a Wi-Fi change on the computer hosting the app. Keep that computer on one stable network during capture. Changing tunnel transport cannot preserve an unavailable host connection.
- **Connected but clock becomes unready:** these are separate states. Participants now default to internet/cellular tolerance: 16 accepted paired samples, estimated uncertainty <=150 ms (best observed RTT <=300 ms), and a clean sample no older than 10 seconds. Strict mode retains <=20 ms / 3.75 seconds. The 5 ms pair-gap distortion filter and minimum-RTT estimate are unchanged; excessive jitter can still prevent readiness even while messages arrive. Broader admission does not establish precise speaker/display alignment; check this with the physical devices. Calibration aborts after the configured freshness/uncertainty bound is exceeded; wait for recovery and start a fresh run. The client reconnects after 10 seconds without any validated server traffic, and hanging joins time out after 10 seconds. Refresh existing phone pages after updating the client.

Quick Tunnels are for small tests, have a **200 in-flight request limit**, and no uptime guarantee; this is not the 1500-phone rehearsal environment. Phone camera uploads use 8 MiB requests so individual requests stay below Cloudflare's upload limit. Keep the uploader open until delivery is confirmed; Retry resumes verified chunks. A working HTTP/WSS check does not measure phone speaker synchronization or optical capture quality. [Cloudflare Quick Tunnel limitations](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).
