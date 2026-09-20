# Railway production topology
Date: 2026-09-20. Status: accepted implementation choice under the user's deployment request. Owner: integration captain.

Use one Docker service and one replica for the authoritative in-memory concert. Node serves the audience Next app on Railway's public PORT and the admin Next zone on loopback; Bun serves the control backend on loopback; the existing Python worker remains an isolated child process. A supervisor terminates the deployment if any application exits. Railway restarts failures.

Mount persistent storage at /data for checkpoint.json, assets, uploads and jobs. Builds contain only source/dependencies, never local .env, runtime media/checkpoints or beatsync-source. Install the locked Python dependencies and generated contracts. Future distributed workers/CDN/database changes require their own measured design; they are not necessary for initial deployment.

Production hostname is htnlive.nicholasching.ca. htn.nicholasching.ca remains the local dev reverse proxy. Verify the Railway-generated HTTPS hostname before adding production DNS; use the exact domain records Railway issues. Set the production session ID at both frontend build and backend runtime; use a production operator credential in Railway Variables. A saved-show migration must copy only the approved music/show through authenticated APIs, not the dev audience identities or captures.

One replica and a persistent volume mean a short service interruption during redeployment. Deployment stops playback and unfinished calibration must be repeated. Disable sleeping/serverless; do not deploy during a performance. CPU/memory limits and OTC_CPU_BUDGET must reflect the account's available allocation, leaving control/UI headroom. Physical timing and venue acceptance remain separate from cloud HTTP/WS checks.
