# Detector test bench

This is a local physical-test harness for improving optical phone detection. It has two independent parts:

1. **Phone flash bench** — phones open a public QR URL, render the exact existing `otc-v1` packet timing with red replacing yellow, then hold red or blue.
2. **Camera monitor** — a local webcam view with live palette, flash, and blob-size settings.

Neither tool writes an audience map, accepts an optical identity, or replaces the production calibration workflow. The production worker still requires the frozen packet/tag/membership/two-pass identity checks.

## Setup

From the repository root:

```powershell
bun install --frozen-lockfile
bun run setup:python
```

The phone page also needs a reachable HTTPS audience origin. For a Quick Tunnel, install the official Cloudflare CLI, then use the command below. A Quick Tunnel is suitable only for this small physical test, not a concert-scale rehearsal.

## Run the phone flash bench

Start the participant Next app on port 3000:

```powershell
bun --cwd client-frontend run dev
```

In a second terminal, publish that same port:

```powershell
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3000
```

Cloudflare prints a temporary HTTPS origin such as `https://example.trycloudflare.com`. Open this exact public URL on the laptop:

```text
https://example.trycloudflare.com/detector-test
```

The QR on that public page encodes the same public `/detector-test` address. Do **not** scan a QR from `http://localhost:3000`; a phone interprets localhost as itself.

The existing operator console also exposes a **Detector flash test** QR beside the normal Join QR. It derives `/detector-test` from the console's saved Participant link, so it uses the same Cloudflare origin after the operator pastes and saves the tunnel URL.

### Phone controls

- Set a unique **Device ID** (0–2047) and shared **Run tag** (0–255) for each test phone as needed.
- Select the color to hold after the sequence.
- Select **Start flash sequence** or **Restart flash sequence**.

The page first renders the exact existing `calibrationPacket(deviceId, runTag)` sequence: 55 slots at 200 ms each (about 11 seconds). The diagnostic palette replaces yellow with red while leaving blue and neutral unchanged:

- zero: `#FF0000` (red)
- one: `#0066FF` (blue)
- neutral: `#111111`

It then holds the chosen red or blue color. This is a flashing visual test: warn participants, provide an exit path, and stop immediately if anyone experiences discomfort.

## Run the camera detector monitor

With a webcam connected:

```powershell
.\.venv\Scripts\python.exe -m otc diagnose-camera --camera 0
```

On POSIX use `.venv/bin/python` instead. Change `--camera 0` for another webcam index.

It opens two desktop windows:

- **Audience Orchestra — detector monitor**: dimmed camera feed, palette masks, tracks, and selected boxes.
- **Detector settings — apply immediately**: all live sliders. A slider applies immediately and clears current diagnostic tracks so the new threshold can be evaluated cleanly.

### Monitor cues

- Magenta box: a neutral bright-rise flash seed. It is only a visibility cue.
- Cyan dot: a currently associated visual track.
- Green `red + blue` box: selected track that has observed at least two red and two blue samples. The qualification stays latched while the same blob remains visible, even during a one-colour hold; one unambiguous overlapping track fragment inherits the latch.

A selected track is removed after 350 ms without a new palette observation. Several independent phone tracks can be green at once; a static red-only or blue-only object remains unselected.

### Useful live controls

- **Red/Blue hue tolerance**: widen cautiously for washed-out screen colors; too wide captures unrelated colored objects.
- **Palette saturation/brightness**: lower for dim or washed-out red/blue phones; this increases background/glare candidates.
- **Flash brightness/max saturation/minimum rise**: tune the neutral white initial-sequence seed detector.
- **Minimum blob width/height**: smallest accepted contour dimension (default 4 px).
- **Minimum area**: separate total-pixel filter for noise and tiny regions.
- **Opening kernel**: removes thin glow bridges; increasing it can erase small screens.

## Suggested physical test

1. Open the public detector-test QR on two or more phones. Give each a distinct Device ID but the same Run tag.
2. Start/restart the exact packet while the camera monitor is open.
3. Confirm magenta flash seeds appear during the neutral bright-rise event.
4. Confirm a green box appears only after each visible phone has shown both palette colors, then disappears when the phone stops or leaves view.
5. Change one slider at a time and record the setting, lighting, distance, device IDs, and observed false positives/negatives before changing worker defaults.

Do not treat this bench as proof of phone synchronization, optical identity accuracy, seating geometry, three-camera registration, or venue-scale performance. Preserve raw participant footage outside Git.

## Verification

Run after changing either tool:

```powershell
.\.venv\Scripts\python.exe -m pytest workers/otc/tests/test_diagnostic.py workers/otc/tests/test_tracking.py -q
.\.venv\Scripts\python.exe -m ruff check workers/otc
bun test client-frontend/tests/detector-test.test.ts
```

For branch gates, run `bun run gate:otc` for the monitor and `bun run gate:client` for the test page. Physical phone/camera validation remains a separate required check.
