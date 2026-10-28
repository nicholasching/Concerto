# Railway redeployment — 2026-10-28

Owner: integration captain. Baseline: main 53dcdddac3ca6b566fa2dfc13449833779aec07d, foundation-v1 verified reference. Existing modified/untracked files are user work and preserved.

Goal: redeploy the application into Railway project 65a7cae3-5ca5-4e45-adec-a7b7e520926c, production environment 31ab0889-ae8a-4ab2-bff0-b722c5191b09. User authorizes deployment and Railway configuration through signed-in browser.

Plan: reuse committed Docker topology; configure one replica, persistent /data volume, production variables and /api/health; deploy repository main; verify public pages, protected operator endpoint and participant WebSocket. Update deployment guide with current project and record deployment evidence. No reference-tree or shared-contract changes.

Assumptions: redeploy committed production source instead of publishing unrelated uncommitted edits; fresh project starts with fresh audience state unless existing production storage can be recovered. Saved show/audio migration needs the prior production source and is separate from infrastructure configuration.

Initial findings: new project is empty. Railway GitHub picker offers nicholasching/Concerto, while local origin and older guide use nicholasching/HackTheNorth. Verify repository identity before selecting. No Railway CLI/config found; browser is signed in. Local Bun exists under .tools and dependencies are present.

Intended checks: root gate:sync if deployment code changes; otherwise inspect config and verify Railway Linux build/start and public HTTPS/WS. Physical phone/camera/acoustic acceptance remains untested.

## Pre-deploy verification
- Verified nicholasching/Concerto main resolves to 53dcdddac3ca6b566fa2dfc13449833779aec07d, identical to the local former HackTheNorth remote. Selected this committed source; local user changes are not published.
- New service: 70146a02-a0f7-4e66-873b-319bb1b22687. Volume: 4046ca01-4e91-4286-8c22-ea8b4d0ea7b3, attached at /data. Staged Dockerfile builder, /api/health with 300-second timeout, public domain generation and six non-secret variables. One replica, Serverless off, On Failure restart (10 retries). Dashboard account permits up to 24 CPU / 24 GB; OTC budget 22 follows the prior deployment.
- ALLOWED_ORIGINS uses Railway's public domain variable plus existing production custom hostname.
- Root gate:sync passed on the preserved working tree: 240 focused tests / 2726 assertions, contract/fixture/boundary/type/lint checks and backend build; log runtime/railway-redeployment-gate-sync.log. This working-tree gate differs from the committed source selected for deployment; Linux deployment build is the source-specific check.
- Previous production Railway project returns 404 in signed-in browser. No recovery or data-copy action performed.
- New production OPERATOR_SECRET must be entered/saved by the user under the browser credential handoff rule. No value recorded in project files/screenshots. Remaining deployment and HTTPS/WS verification depend on that entry.

## Deployment started
- User saved the production operator secret in Railway and confirmed completion. Applied 17 staged changes; deployment a93924f4-4477-4b28-bd85-bbbb40e775cb builds committed main 53dcddd.
- Generated URL: https://concerto-production-02db.up.railway.app. Public URL verification pending build completion.
- Attached htnlive.nicholasching.ca on port 3000. Railway issued CNAME htnlive -> w7ivpnq9.up.railway.app and TXT _railway-verify.htnlive -> railway-verify=04fc4eb4cafd72a304df57aa805b31a49f7a8b14356ef6fdae8a9602f7dbb271. Existing public DNS still points to 7mi71yo1.up.railway.app; TLS request fails. Inspecting existing Cloudflare session for scoped DNS update, without creating persistent Railway DNS permissions.

## DNS changes
Updated only the two existing production records in Cloudflare: htnlive CNAME to w7ivpnq9.up.railway.app (DNS only), and _railway-verify.htnlive TXT to Railway's newly issued verification string. Existing htn development tunnel and all other records are preserved. Cloudflare confirmed both saves; public resolver 1.1.1.1 returns the new CNAME. Railway domain validation/TLS pending propagation.

Build logs confirm Dockerfile/BuildKit despite service Settings reverting its builder label to Railpack default after deployment. Frozen Bun install, locked Python install, both frontend/backend builds and OTC CLI help completed; image sha256:80f37202e3fca51a887f1f0dc9a15df2d6a7a08af17108b4bbe2b192514887f8 is being published. Do not infer failure from the settings label when actual logs prove the Dockerfile path.

## First public checks and origin correction
- Initial generated-domain smoke passed HTTPS health/session and all four pages, 401 protection for missing/invalid operator credentials, and successful authenticated snapshot. Fresh session has four default lanes, zero tracks/clips, stopped transport. No saved show/audio was migrated because prior production project is unavailable.
- CORS assertion for generated origin failed. Inspected only ALLOWED_ORIGINS (never operator secret): Railway resolved RAILWAY_PUBLIC_DOMAIN to the newly attached custom hostname, producing the custom origin twice and omitting generated origin. Updated ALLOWED_ORIGINS to the two explicit HTTPS origins. Documented this platform behavior in the guide. Applying staged correction and repeating the public checks.

## Custom-domain acceptance
- Cloudflare CNAME and TXT verified through public resolver 1.1.1.1. Custom HTTPS /api/health returns 200 with normal certificate validation.
- runtime/railway-public-smoke.ts against https://htnlive.nicholasching.ca passed 6 groups: health/session/four public pages; missing/invalid operator credentials rejected; configured operator credential authenticates; same-origin CORS; participant join/resume; schema-valid WSS clock reply. Log runtime/railway-smoke-custom.log. No credential or resume token printed.
- Real Chrome audience page reaches Connected / In sync. Music remains Waiting for show because no audio was migrated. Browser audio/physical phones are not verified.
- Startup logs show both Next 16.2.7 processes ready and production supervisor listening on 3000 with persistent data /data. Two unknown Server Action requests appear in logs; known public routes and authenticated API checks pass. No adjacent application changes made.
- Origin correction deployment 7d7be6d7-6ed1-46ae-bb7f-c77467addfe5 is building; persistence verification holds a pre-restart participant token in process memory and waits for the new epoch.

## Final verification and handoff — verified infrastructure
- Final deployment 7d7be6d7-6ed1-46ae-bb7f-c77467addfe5 is Active / Deployment successful. Details confirm Dockerfile at /Dockerfile, US East, one replica, /api/health, 300-second timeout and On Failure / 10 retries. Source remains committed main 53dcddd; application source and prior uncommitted edits preserved.
- Both public origins now pass all 6 remote smoke groups after the final config deployment: generated Railway hostname and https://htnlive.nicholasching.ca. Same new server epoch 4575f509-b02f-40cd-9090-b2374d6f20ae confirms both route to the same authority. Logs: runtime/railway-smoke-generated.log and runtime/railway-smoke-custom.log.
- Persistence passed across the actual Railway redeployment: server epoch changed, and the pre-deploy participant resume token recovered the same device ID. Token existed only in verifier process memory. Log: runtime/railway-persistence-check.log. This verifies identity checkpoint persistence, not a media upload/restart test.
- Real Chrome verifies audience Connected/In sync and successful operator sign-in/dashboard. Final admin tab is left open. No physical sound, camera/video processing, acoustic timing or venue load checks performed.
- Fresh show is stopped with zero tracks/clips. The deployed commit uses lane labels Melody / Vocals / Percussion / Percussion 2; local label changes remain unpublished. No prior show, audience map or recordings were migrated. Test joins allocated a few persistent diagnostic device IDs; no reset or live-show mutation performed.
- Changed repository files: docs/railway-deployment.md (new project/repository, both explicit origins and platform behavior), this journal. No commits/pushes. gate:sync passed; documentation diff check passed. beatsync-source untouched.
- Exact next operator action: open https://htnlive.nicholasching.ca/admin, upload approved stems and save the show; then use /present for audience QR and perform a fresh calibration/rehearsal. Old production data recovery, if desired, needs the old project's owner/backups; no recovery availability is claimed from its 404.
