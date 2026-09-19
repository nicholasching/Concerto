# Audience Orchestra development context

Read root AGENTS/rules/masterplan, this index, architecture/glossary, your stage/status/handoff and relevant decisions before coding.

## Current checkpoint

### Local integration, 2026-09-19

All four feature branches are merged into main, through merge 5eb08ab. Captain integration is verified locally: real clocks, operator authentication, show editing, calibration uploads/worker/review, map selection, routing, transport, mix and recovery are connected. All software gates, real-worker E2E, production startup, source isolation and the five-minute 1500-socket test pass. User requested local functionality before Railway deployment.

Read [integration status/handoff](teams/integration/handoff.md), [verification](evidence/integration/verification.md), [integration journal](teams/integration/journal/20260919-captain-integration.md), [accepted integration boundaries](decisions/20260919-140000-integration-boundaries.md), and [stage 05](stages/05-integration-rehearsal.md). Physical phone/camera/acoustic/venue acceptance is still outstanding. The foundation notes below are historical, not the current implementation inventory.

Cloudflare device testing now uses a single audience origin for HTTP/audio/WSS and a saved public QR URL. Read the [setup guide](../docs/cloudflare-tunnel.md), [routing decision](decisions/20260919-cloudflare-audience-origin.md) and [verified tunnel journal](teams/integration/journal/20260919-cloudflare-testing.md). Next servers require Node 22+; backend/tooling remain Bun. A real Quick Tunnel and desktop browser passed; physical phone evidence remains outstanding.

The named audience hostname **htn.nicholasching.ca** is now configured and running on this computer. Public joins, participant-only authorization, WSS clock exchange and audio downloads pass; the real browser verifies 4/4 assets and the local QR uses the named address. See the [named-tunnel journal](teams/integration/journal/20260919-named-cloudflare.md). `bun run tunnel:named` reads a private token file outside the repository through the ignored local `.env`; tokens never go in Git.

The [connectivity investigation](teams/integration/journal/20260919-sync-connectivity.md) correlates tunnel outages with host Wi-Fi changes. A 90-second comparison found stable local clocks and intermittent stale samples over the public path. Participant recovery now handles silently broken sockets and hanging HTTP joins; clock accuracy/freshness thresholds remain intact. Refresh phone pages before retrying an interrupted calibration.

At the user's subsequent request, participants now default to an explicit [internet/cellular timing profile](decisions/20260919-internet-clock-readiness.md): best RTT <=300 ms and accepted-sample freshness <=10 seconds. `NEXT_PUBLIC_CLOCK_PROFILE=strict` restores the original thresholds. The estimator and physical acceptance targets are unchanged; the page displays actual uncertainty and relaxed readiness. See the [verification journal](teams/sync-control/journal/20260919-internet-clock-profile.md).

First physical camera clip: after the [worker failure investigation](teams/integration/journal/20260919-camera-worker-failure.md), decoder v1.4 now recovers exactly **two devices, 9 and 11**, from the user's original recording. Both passes agree with zero corrected/erased bits. The [two-screen investigation](teams/otc-localization/journal/20260919-two-physical-screens.md) records failures, final live-browser evidence and 90 passing Python tests. The [console follow-up](teams/admin-console/journal/20260919-single-camera-review.md) adds camera selection and distinguishes decoded IDs from seat coordinates. No anchors means two column-only results; candidate remains uncommitted. This single clip does not establish venue/three-camera acceptance. All five branches were published before this follow-up; integrated fixes are on main.

The user's current concert uses **Melody, Vocals and Percussion**, with one shared **512 MiB decoded-audio budget per phone**. See the [channel migration](teams/integration/journal/20260919-three-channels.md), [budget verification](teams/integration/journal/20260919-decoded-audio-budget.md), [channel decision](decisions/20260919-three-show-channels.md) and [budget decision](decisions/20260919-decoded-audio-budget.md). The four development teams are unchanged.

### Historical foundation checkpoint

- Software foundation is verified and ready for four teams. Canonical baseline: Git tag `foundation-v1`; resolve its SHA with `git rev-parse foundation-v1` and record it in your first journal. The immutable tag avoids embedding its own commit hash inside itself.
- Four local feature branches start at that baseline. Remote publication is separate; see root README.
- Contracts, exhaustive codebook, fixture harnesses, application shells, Python boundary CLI, gates and CI configuration exist. NTP, concert APIs, sound, flashing, video localization, interactive console, load/e2e and physical evidence remain assigned work.
- BeatSync remains unchanged. Only `epochNow()` is extracted; full MIT attribution and source hashes are recorded.
- See [verification](evidence/foundation/verification.md) for checks and limits. Performance numbers remain targets. Hosted CI has not run during local preparation.

## Ownership and starting points

| Team / human lead | Branch | Stage | Current handoff |
| --- | --- | --- | --- |
| 1 / assign; default captain | feat/sync-control | [01](stages/01-sync-control.md) | [status](teams/sync-control/status.md), [handoff](teams/sync-control/handoff.md) |
| 2 / assign | feat/audio-client | [02](stages/02-audio-client.md) | [status](teams/audio-client/status.md), [handoff](teams/audio-client/handoff.md) |
| 3 / assign | feat/otc-localization | [03](stages/03-otc-localization.md) | [status](teams/otc-localization/status.md), [handoff](teams/otc-localization/handoff.md) |
| 4 / assign | feat/admin-console | [04](stages/04-admin-console.md) | [status](teams/admin-console/status.md), [handoff](teams/admin-console/handoff.md) |

Captain owns shared context/contracts/testkit/root/CI. Each lead owns its stage/status/handoff; agents create distinct journal files. ADRs are append-only and uniquely named. Root rules contain templates.

## Shared reading

- [Architecture](architecture.md), [glossary](glossary.md), [BeatSync provenance](beat-sync-extraction.md).
- [Protocol](schema/protocol.md), [OTC](schema/otc.md), [playback](schema/playback.md).
- [Foundation decision](decisions/20260919-000001-foundation-v1.md), [foundation stage](stages/00-foundation.md), [integration](stages/05-integration-rehearsal.md).
- [Foundation journal](teams/foundation/journal/20260919-foundation.md).

Keep raw audience recordings, secrets, large artifacts and machine configuration outside Git. Commit hashes and reproduction procedures with evidence instead.
