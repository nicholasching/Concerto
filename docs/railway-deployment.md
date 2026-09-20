# Deploy Resonance to Railway

Production: **https://htnlive.nicholasching.ca**. Development remains **https://htn.nicholasching.ca**, served by the existing local reverse proxy.

The root Dockerfile installs Bun 1.3.14, Node 22, Python 3.13 and the locked recognition dependencies, builds both Next apps and the backend, then runs `bun run start`. One public port serves audience `/`, operator `/admin`, projector `/present` and camera crew `/upload`. The admin/backend ports stay inside the container. Use **one service, one replica, one volume**; the current concert state is authoritative in one backend process.

## First deployment

1. Open [Resonance on Railway](https://railway.com/project/74a8b8f8-48eb-45de-9070-9b2643b5f423) and select **production**.
2. Add a service connected to GitHub repository **nicholasching/HackTheNorth**, branch **main**. Leave Root Directory at the repository root. Railway detects the root **Dockerfile**. Leave custom Build Command and Start Command empty; the image defines both. Do not use the development launcher.
3. In the project canvas choose **Add → Volume**, attach it to this service and enter mount path **`/data`**. This holds `checkpoint.json`, `assets/`, `uploads/` and `jobs/` across deployments. Build-time files do not populate a volume; never bake local runtime data into the image.
4. Open service **Variables** and add the values below. Enter the production `OPERATOR_SECRET` directly in Railway. Never put its value in Git or screenshots. `SESSION_ID` is used during both the frontend build and backend startup; changing it requires rebuilding and a separate checkpoint/volume.

   | Variable | Value |
   | --- | --- |
   | `PORT` | `3000` |
   | `NODE_ENV` | `production` |
   | `SESSION_ID` | `prod-session` |
   | `DATA_DIR` | `/data` |
   | `ALLOWED_ORIGINS` | `https://htnlive.nicholasching.ca` |
   | `OPERATOR_SECRET` | Your production operator password |
   | `OTC_CPU_BUDGET` | `22` for the current 24-vCPU allocation; reduce this if the service limit is lower |

   The image supplies loopback `BACKEND_INTERNAL_URL=http://127.0.0.1:8080`, `ADMIN_INTERNAL_URL=http://127.0.0.1:3001` and its Python interpreter. It also caps `OPENBLAS_NUM_THREADS`, `OMP_NUM_THREADS` and `MKL_NUM_THREADS` to `1` so native libraries cannot multiply the 22 analysis processes into thousands of threads. Keep these defaults. Leave `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` and mock settings unset. The projector derives the join URL from its own origin.

5. In **Settings**, set Healthcheck Path to **`/api/health`** and timeout to **300 seconds**. Keep **one replica**, **Serverless off**, and **On Failure** restart policy. Choose the nearest available region to the venue. Keep enough CPU/memory headroom for control and audio serving alongside recognition.
6. Apply the staged changes with **Deploy**. Verify the build uses the Dockerfile, installs the Python worker and builds both Next apps. Logs must show all three application processes starting. Wait for the deployment to be healthy.
7. Under **Settings → Networking**, select **Generate Domain** targeting **port 3000**. Open its HTTPS URL and verify `/api/health`, `/admin`, `/present` and `/upload`. The admin should require the production password; an audience phone should join and synchronize. This isolates app startup from DNS setup.
8. Add custom domain **`htnlive.nicholasching.ca`**, targeting port **3000**. Railway displays the exact DNS records for this deployment. In the authoritative DNS provider add its **CNAME** for `htnlive` and its ownership **TXT** record exactly as shown. If DNS is managed by Cloudflare, start with the new CNAME **DNS only**. Leave the existing `htn` tunnel record intact. Wait for Railway domain verification and its TLS certificate.
9. Open **https://htnlive.nicholasching.ca/admin** and sign in. Copy the approved saved show/audio to this fresh production session using authenticated uploads and show save. Do not copy development device tokens, mappings or camera recordings. Verify downloaded audio hashes and the four section presets.
10. Join with real audience phones, verify music and sound readiness, perform a fresh calibration, commit automatic sections and rehearse playback. A server restart preserves the saved show/media/identities but stops playback and requires repeating an unfinished calibration. Avoid deployment during a performance.

Railway's current documentation covers [Dockerfile builds](https://docs.railway.com/builds/dockerfiles), [persistent volumes](https://docs.railway.com/volumes), [healthchecks](https://docs.railway.com/deployments/healthchecks) and [domain setup](https://docs.railway.com/networking/domains). The dashboard's generated DNS values are authoritative; do not guess a Railway CNAME or TXT token.

## Checks and operations

`bun run gate:sync` includes the production configuration regressions. The isolated smoke runner `bun tools/deploy/smoke.ts runtime/railway-production-20260920` expects a source copy built with `BACKEND_INTERNAL_URL=http://127.0.0.1:18086`, `ADMIN_INTERNAL_URL=http://127.0.0.1:13087`, `NEXT_PUBLIC_SESSION_ID=production-smoke`. It checks all public pages, protected control, participant HTTP/WS, upload/save and restart persistence using disposable state, then stops its processes.

The Docker image excludes `.env`, runtime files, dependency caches and `beatsync-source/`. Local build/smoke success does not establish a successful Linux image build or physical camera/audio behavior; record those separately. A Railway volume prevents overlapping deployments from sharing writable state, so redeployment has a short interruption. Keep the service running for the event and configure volume backups in Railway for saved media.
