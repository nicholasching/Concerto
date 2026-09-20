# Single-domain stage workflow

Date / author / team: 2026-09-19, integration captain.
Status: accepted under the user's explicit routing, reset and UI request.
Affected teams: sync-control, audio-client, admin-console.

The audience Next app remains the public entry point. /admin is a separately built Next zone with its own asset base path; /control routes authenticated operator HTTP/WebSocket traffic. /present displays aggregate public counts and the audience QR, and /upload accepts camera recordings through a limited camera credential. Passwords stay out of browser bundles and Git. This supersedes the earlier tunnel decision's local-only admin restriction because the user now explicitly requests admin and uploads on the shared hostname.

Reset clears audience identity, positions, routing and transient calibration/control work, changes the server epoch, and stops playback. Prepared show/media remain available for the next audience. Live sockets close with an explicit reset signal, and their pages stay reset until refreshed. Former resume credentials cannot reclaim prior identities. Run tags remain monotonic to reject old physical recordings.

Participant UI may attempt automatic audio startup but cannot claim unlocked sound without a running AudioContext. Browsers can require a user gesture: show a single enable-sound action only in that case. Asset download/decoding can begin with a suspended context. A minimal calibration stage on participant snapshots distinguishes waiting/processing from completed-but-unmapped fallback, including after refresh. Existing optical packet and clock estimator are unchanged.

References: [Next multi-zone example](https://github.com/vercel/next.js/blob/canary/examples/with-zones/README.md), [Chrome autoplay policy](https://developer.chrome.com/blog/autoplay), [Cloudflare request upload limits](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/). Eight-MiB camera chunks stay below the documented 100-MB Free/Pro request limit and retain the existing one-GiB file ceiling.
