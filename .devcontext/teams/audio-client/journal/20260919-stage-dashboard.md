# Simplified audience and stage pages

Integration captain on main, baseline f71cb1e. [Decision](../../../decisions/20260919-single-domain-stage-workflow.md), [integration evidence](../../integration/journal/20260919-stage-dashboard.md), [operator guide](../../../../docs/stage-dashboard.md).

Audience UI now shows connection/clock/music checks, volume/wait instructions, existing calibration renderer, and mapped section or three manual section choices after calibration. Audio startup is automatic when allowed; a suspended/interrupted context truthfully retains a single tap action. Assets preload before unlock. Shared pending loads prevent automatic preload and gesture preload from decoding the same asset twice. Reset code 4002 clears browser identity and prevents wake/retry from immediately refilling the cleared registry.

`/present` generates a local QR and polls aggregate counts; `/upload` authenticates with a camera-only token and delivers hashed 8 MiB chunks with resume. Camera credentials survive transient network polling failures. A GET-501 fallback supports the older live backend during this update. The former admin QR component is removed; validated participant-link construction/tests moved here and always target `/`.

Production-browser checks: automatic Connected/In sync/Verified, one tap reaches actual audio-ready telemetry, completed calibration exposes section buttons, Center produces a section-only screen, and reset leaves the page disconnected. Phone-sized upload delivered a real generated MP4 visible in admin. No new physical acoustic/autoplay guarantee: rehearse iOS/Android on the venue network.
