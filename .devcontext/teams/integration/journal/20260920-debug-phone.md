# Standalone debug phone flash bench

Date / agent: 2026-09-20 / Codex (integration scope)

## Goal, baseline and ownership

- Goal: extract the `fix-detection` branch's QR-accessible per-phone flash
  bench into a root-level `debug_phone/` tool.
- Baseline: `phone-detection` at `7cbe031`; worktree was clean before this
  work. The source branch is `fix-detection` at `266909d`.
- Owned files: `debug_phone/` and this journal. No existing client, backend,
  contract, lockfile, or production calibration file is changed.

## Assumption and plan

The source bench controls each phone independently after it scans the QR; it
does not broadcast an operator command to all phones. "On demand" is therefore
implemented as Start/Restart/Stop controls available on every scanned phone,
matching the branch behavior. The tool remains deliberately outside the
production participant route and backend.

1. Create a small Bun static server that creates a QR from the effective public
   request origin; verify its QR endpoint and static assets locally.
2. Reproduce the 55-slot 200 ms packet with red/blue diagnostic colors and
   independent hold/restart/stop controls; verify every packet against
   `@orchestra/contracts/otc`.
3. Record deterministic and physical-test limitations separately.

## Source characterization

Inspected `fix-detection:client-frontend/src/app/detector-test/page.tsx`,
`.../qr/route.ts`, and `.../lib/detector-test.ts`, plus
`DETECTOR_TEST_BENCH.md`. The branch's page uses the canonical packet timing
and a diagnostic palette of red `#FF0000`, blue `#0066FF`, and neutral
`#111111`, before holding a selected red or blue color.

`debug_phone/public/packet.js` is a small self-contained implementation so the
tool has no concert runtime dependency. `debug_phone/packet.test.ts` compares
it slot-for-slot with the canonical contract to prevent drift.

The standalone server reuses the existing, already-pinned `qrcode` package
from `client-frontend/node_modules`. Keeping `debug_phone` out of the root
workspace avoids an unrelated workspace/lockfile change; a normal frozen-lock
install creates that declared client dependency in a fresh checkout.

## Verification

- Deterministic: `bun test debug_phone/packet.test.ts` passed on 2026-09-20:
  3 tests, 37 assertions. It compared every slot for IDs 0/1/7/1024/2047 and
  tags 0/37/255, checked the red/blue/neutral palette and hold transition, and
  rejected out-of-range IDs/tags.
- Static type check: `bunx tsc --ignoreConfig --noEmit --target ES2022 --module
  ESNext --moduleResolution Bundler --esModuleInterop --skipLibCheck --allowJs
  --types bun,node debug_phone/server.ts debug_phone/packet.test.ts
  debug_phone/public/packet.js` passed on 2026-09-20.
- Local HTTP: started `bun debug_phone/server.ts` at port 3002. `/` returned
  200 and the Start control; `/qr.svg` returned 200, `image/svg+xml`, a valid
  SVG, and `X-Debug-Phone-Url: http://127.0.0.1:3002/`; `/app.js` returned 200
  and imports the packet module. The server was stopped after the check.
- Live tunnel setup: downloaded the official Cloudflare CLI only into ignored
  `.tools/cloudflared.exe`, then started an accountless Quick Tunnel to the
  running port 3002. Cloudflare registered a QUIC connection at `yyz04` and
  supplied a temporary HTTPS origin. A local forwarded-header check returned
  that same public origin in `X-Debug-Phone-Url`, so loading the public URL on
  the laptop generates a phone-usable QR rather than a localhost QR. The
  server and tunnel remain running for the requested manual test; this is not
  yet a physical phone scan result.
- Physical: open a phone-reachable HTTPS origin, scan from a real phone, start
  and stop the sequence, and film it with the detector monitor. This is not yet
  evidence of optical decode, synchronization, or accessibility compliance.
