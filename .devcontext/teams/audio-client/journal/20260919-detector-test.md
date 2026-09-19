# Local detector-test page

Date / agent: 2026-09-19 / fix-detection

## Scope and assumption

The user requested a separate testing-only phone page with a scannable QR code, repeatable initial flash, and held calibration color. Although `client-frontend/` is Team 2-owned, the user directly assigned this narrowly scoped test surface; no shared protocol, lockfile, production calibration path, or reference code is changed.

## Implementation

- `/detector-test` generates a QR code for its own current origin/path, so it can be scanned from a laptop into phones through the existing audience tunnel.
- A button begins three 250 ms white/neutral flashes, then holds amber (`#ffb000`) or blue (`#0066ff`). The active view has Restart and Exit controls.
- The test is deliberately local/per-phone rather than a new server protocol: it tests phone visibility and camera threshold tuning only. It does not claim clock synchronization or optical identity acceptance.

## Verification planned

`bun test client-frontend/tests/detector-test.test.ts` passes: three white pulses alternate with neutral and then hold the selected color. A physical phone must scan the HTTPS QR and be filmed with the detector monitor; localhost QR behavior is intentionally documented as desktop-only.

`bun run gate:client` completed successfully after the frozen-lockfile install restored the existing QR package. It includes 117 client/audio tests and the production client build. Physical QR scanning, phone display brightness, visible flash boxes, and camera recordings remain required evidence.

The first local `/detector-test` request exposed that the client workspace had not declared the already-pinned `qrcode` package used by the new page. Added `qrcode@1.5.4` to `client-frontend/package.json` and refreshed `bun.lock` without changing package versions. The running local Next server now returns HTTP 200 at `http://localhost:3000/detector-test`; the repeated client gate compiled the page successfully.

The operator console's existing saved Participant link is the authoritative current tunnel URL. Added a companion Detector flash test QR beside the join QR, deriving `/detector-test` from that exact origin and deliberately removing the session query. This gives phones the same Cloudflare audience tunnel while keeping the test page separate from joining/calibration.

Correction: the first diagnostic page used an invented white/neutral pulse before holding a color. The user rejected that behavior. It now uses the exact frozen `calibrationPacket(deviceId, runTag)` and `symbolColor` palette path from the production calibration renderer: 55 200-ms slots including its guards/preamble/tag/repeated ID encoding, then the selected hold color. The test page exposes bounded device-ID and run-tag inputs so physical phones can emit distinct real packet identities.
