# Audience Orchestra development context

Read root AGENTS/rules/masterplan, this index, architecture/glossary, your stage/status/handoff and relevant decisions before coding.

## Current checkpoint

### OTC v2 reliability

New runs use 47 symbols at 250 ms (11.75 s), with no optical run-tag field. Joint identity decoding recovers complementary losses across both passes; preamble evidence can replace missing pilots. Red-only compact-core detection fixes observed merging with skin/clothing while preserving legacy amber behavior. See the [decision](decisions/20260920-otc-v2-redundancy.md) and [implementation/checks](teams/integration/journal/20260920-otc-v2.md). Correct clip selection is operator-managed; a fresh physical v2 rehearsal remains required.

The [wider-color detection follow-up](teams/otc-localization/journal/20260920-tolerant-detection.md) recovers **6/6** phones from the latest physical v1 recording (previously 4/6) and retains the amber 5/5 regression. The local app has been restarted with v2 and its public origin verified; refresh participant/admin pages before the next calibration.

### Audience music visualizer

The `feat/color-music-sync` feature is integrated with scheduled playback: ready phones display their assigned channel color, with brightness following their own audio after mix and lease gating. Calibration and recovery/manual-section controls take priority. Review fixes, tests and browser evidence are in the [integration journal](teams/integration/journal/20260920-color-music-integration.md); see the [operator guide](../docs/stage-dashboard.md). Physical phone display/audio alignment remains a rehearsal check.

### OTC CPU parallelism

The worker distributes independent frame analysis across the available CPU allocation instead of stopping at one analysis core per camera. One shared budget respects container quotas; all frames retain PTS order for tracking. The user plans up to 24 Railway CPUs. See the [decision](decisions/20260920-otc-frame-parallelism.md), [performance configuration](../docs/otc-performance.md) and [measured verification journal](teams/otc-localization/journal/20260920-frame-parallelism.md). Detection and geometry accuracy work remains separate; live Railway throughput must be measured after deployment.

### Red/blue calibration palette

New runs use user-requested full red `#FF0000` and existing blue `#0066FF`. Decoder v1.7 selects pilot/phase checks from the saved palette and retains old amber/blue captures. Timing/codewords are unchanged. See the [decision](decisions/20260920-red-blue-calibration.md) and [checks/handoff](teams/otc-localization/journal/20260920-red-blue-palette.md).

### Manual section audio routing

Playback fixes are committed/pushed as **a29625e**. The manual-section follow-up now schedules a matching audio assignment and admits ready manual phones to an ongoing show at its current playhead. User-confirmed defaults: left → Melody, center → Vocals, right → Percussion. See the [decision](decisions/20260920-manual-section-audio-routing.md) and [verification/handoff](teams/integration/journal/20260920-manual-section-routing.md).

### Playback recovery and two-second controls

All prior fixes are committed/pushed as **cb271b1**. The following playback changes implement two-second performance/assignment cues and gate recovery/first playback on current clock, audio-output and asset readiness. Read the [decision](decisions/20260920-playback-readiness-and-cue-lead.md) and [verification journal](teams/integration/journal/20260920-playback-recovery.md). Physical acoustic comparison remains separate from passing software/browser checks.

### Five-phone positioning follow-up

All outstanding UI work was committed/pushed as **eb274b3** before debugging. Decoder v1.6 now accepts all five valid devices in the supplied PXL recording; new uploads automatically request approximate stage-facing map positions. The user's broader valid-code/no-collision policy is implemented with explicit warnings, retained run/membership/collision checks, and a distinct frame-layout mode. Read [evidence and handoff](teams/integration/journal/20260919-five-phone-positioning.md), [geometry decision](decisions/20260919-automatic-frame-layout.md), and [acceptance decision](decisions/20260919-valid-code-acceptance.md). Earlier manual-preset requirements are historical.

### Stage dashboard update, 2026-09-19

The mapping checkpoint was committed and pushed as **f71cb1e** before the UI work. The new shared-origin stage workflow is documented in the [operator guide](../docs/stage-dashboard.md), [decision](decisions/20260919-single-domain-stage-workflow.md), and [verification journal](teams/integration/journal/20260919-stage-dashboard.md). Audience `/`, admin `/admin`, projector `/present` and phone recordings `/upload` share one origin. Reset, one-page operation, automatic audience readiness and post-calibration section fallback are implemented. The journal separates unit/build evidence, production browser checks and outstanding physical rehearsal. It also records the live upload-route compatibility fix without restarting the user's active calibration.

### Local integration, 2026-09-19

All four feature branches are merged into main, through merge 5eb08ab. Captain integration is verified locally: real clocks, operator authentication, show editing, calibration uploads/worker/review, map selection, routing, transport, mix and recovery are connected. All software gates, real-worker E2E, production startup, source isolation and the five-minute 1500-socket test pass. User requested local functionality before Railway deployment.

Read [integration status/handoff](teams/integration/handoff.md), [verification](evidence/integration/verification.md), [integration journal](teams/integration/journal/20260919-captain-integration.md), [accepted integration boundaries](decisions/20260919-140000-integration-boundaries.md), and [stage 05](stages/05-integration-rehearsal.md). Physical phone/camera/acoustic/venue acceptance is still outstanding. The foundation notes below are historical, not the current implementation inventory.

Cloudflare device testing now uses a single audience origin for HTTP/audio/WSS and a saved public QR URL. Read the [setup guide](../docs/cloudflare-tunnel.md), [routing decision](decisions/20260919-cloudflare-audience-origin.md) and [verified tunnel journal](teams/integration/journal/20260919-cloudflare-testing.md). Next servers require Node 22+; backend/tooling remain Bun. A real Quick Tunnel and desktop browser passed; physical phone evidence remains outstanding.

The named audience hostname **htn.nicholasching.ca** is now configured and running on this computer. Public joins, participant-only authorization, WSS clock exchange and audio downloads pass; the real browser verifies 4/4 assets and the local QR uses the named address. See the [named-tunnel journal](teams/integration/journal/20260919-named-cloudflare.md). `bun run tunnel:named` reads a private token file outside the repository through the ignored local `.env`; tokens never go in Git.

The [connectivity investigation](teams/integration/journal/20260919-sync-connectivity.md) correlates tunnel outages with host Wi-Fi changes. A 90-second comparison found stable local clocks and intermittent stale samples over the public path. Participant recovery now handles silently broken sockets and hanging HTTP joins; clock accuracy/freshness thresholds remain intact. Refresh phone pages before retrying an interrupted calibration.

At the user's subsequent request, participants now default to an explicit [internet/cellular timing profile](decisions/20260919-internet-clock-readiness.md): best RTT <=300 ms and accepted-sample freshness <=10 seconds. `NEXT_PUBLIC_CLOCK_PROFILE=strict` restores the original thresholds. The estimator and physical acceptance targets are unchanged; the page displays actual uncertainty and relaxed readiness. See the [verification journal](teams/sync-control/journal/20260919-internet-clock-profile.md).

First physical camera clip: after the [worker failure investigation](teams/integration/journal/20260919-camera-worker-failure.md), decoder v1.4 now recovers exactly **two devices, 9 and 11**, from the user's original recording. Both passes agree with zero corrected/erased bits. The [two-screen investigation](teams/otc-localization/journal/20260919-two-physical-screens.md) records failures, final live-browser evidence and 90 passing Python tests. The [console follow-up](teams/admin-console/journal/20260919-single-camera-review.md) adds camera selection and distinguishes decoded IDs from seat coordinates. No anchors means two column-only results; candidate remains uncommitted. This single clip does not establish venue/three-camera acceptance. All five branches were published before this follow-up; integrated fixes are on main.

The user's current concert uses **Melody, Vocals and Percussion**, with one shared **512 MiB decoded-audio budget per phone**. See the [channel migration](teams/integration/journal/20260919-three-channels.md), [budget verification](teams/integration/journal/20260919-decoded-audio-budget.md), [channel decision](decisions/20260919-three-show-channels.md) and [budget decision](decisions/20260919-decoded-audio-budget.md). The four development teams are unchanged.

The current four-device camera recording now has visible coordinates in committed map revision 10. The operator supports calibration from a saved preview, an explicit stage-facing approximate frame preset, and click/box/lasso or movable left/center/right divider selection. One to three camera views work independently. See the [mapping guide](../docs/audience-mapping.md), [decision](decisions/20260919-seat-layout-and-regions.md), and [physical-file/UI verification](teams/integration/journal/20260919-seat-map-selection.md). Image-based positions are approximate; measured venue seat accuracy is still unverified.

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
