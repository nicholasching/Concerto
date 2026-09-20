# Debug phone flash bench

This is a standalone, physical-test page extracted from the `fix-detection`
branch's detector flash page.  It has no connection to the concert backend:
it does not join a session, create an audience identity, or change production
calibration state.

## Run

From the repository root, run:

```powershell
bun debug_phone/server.ts
```

Run the repository's normal `bun install --frozen-lockfile` first when setting
up a fresh checkout. The server reuses the already-declared QR encoder from
the participant frontend and does not add a workspace or lockfile dependency.

Open `http://localhost:3002` on the laptop. For a phone to scan the QR code,
publish that same port through a reachable HTTPS URL, for example:

```powershell
cloudflared tunnel --url http://127.0.0.1:3002
```

Open the resulting HTTPS address on the laptop. The QR code then contains that
public address. A QR code generated from `localhost` opens the phone's own
localhost and will not reach this server.

Set a device ID (0–2047), a shared run tag (0–255), and the colour to hold.
On **Start flash sequence**, the phone renders the 55-slot, 200 ms OTC packet
with the diagnostic red/blue palette, then holds the selected colour. Restart
or Stop it at any time. Each phone is controlled independently.

This emits a full-screen flashing pattern. Warn participants, provide a clear
exit path, and stop immediately if anyone is uncomfortable. It is a visibility
and camera-tuning aid only; it does not establish timing, optical identity,
mapping, or venue-scale readiness.

## Check

```powershell
bun test debug_phone/packet.test.ts
```

The test compares the standalone packet generator against the canonical
`@orchestra/contracts/otc` implementation, including every slot.

## Clip boxing

Open `http://localhost:3002/detection-boxing` on this computer while the debug
server is running. Upload one clip and, if needed, select its recorded
clockwise rotation. The tool runs the existing OTC screen detector/tracker and
returns an annotated MP4. Cyan dots are screen tracks; a green `red + blue`
box appears only after the same track has produced two red and two blue samples
and stays while the track remains visible. This diagnostic path is intentionally
for the red/blue flash bench; legacy amber/blue clips do not receive green boxes.

This page and its upload/result API intentionally reject Cloudflare-forwarded
requests. Do not send raw camera footage through the public QR tunnel. A box
is diagnostic tracking evidence only; it is not a decoded device ID, an
accepted calibration result, or a map position.
