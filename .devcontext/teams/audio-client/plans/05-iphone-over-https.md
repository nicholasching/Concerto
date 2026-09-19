# Subplan 05: real iPhone over a temporary HTTPS tunnel
Status: in progress 2026-09-19 (setup built and checked; iPhone checklist pending)
Owner / branch / baseline: Team 2 / feat/audio-client / 4952408 (slice 4)
Source: masterplan §6 Team 2 step 2 and "Media, memory, and network budgets", §8 physical evidence rules, §11 runbook. Stage brief 02 slice 5. rules.md §11 (keep physical evidence separate).

## Goal

Run the existing client on a real iPhone and record what works:
- join and resume
- Enable sound, including with the silent switch on
- preload over a real network
- channel playback
- interruptions (calls, app switch, lock)
- the calibration flash on a real screen

The result is a short physical evidence report, plus fixes for anything the phone exposes. There's one iPhone, so this slice doesn't claim anything about sync between phones.

## Why a tunnel, not hosting

- A phone can't reach the laptop's `localhost`.
- Plain `http://<laptop-ip>` isn't a secure context. The browser then turns off `crypto.subtle` (our hash check) and the screen wake lock.
- So the phone needs `https://`. A temporary Cloudflare quick tunnel gives free `https://…trycloudflare.com` links without an account.
- The event deployment and its HTTPS remain Team 1's work (README). This setup is only for testing.

## Changes

1. **iPhone silent switch.** In `AudioContextHost.unlock()`, set `navigator.audioSession.type = "playback"` when the API exists (iOS 16.4+), before resuming. This is how BeatSync (`store/global.tsx`) makes Web Audio play with the ring/silent switch on silent. It replaces the old workaround we dropped in slice 1. Add a unit test that it's set when present and skipped when absent.
2. **Tunnel script** `tools/client-demo/phone.ts`, run with `bun tools/client-demo/phone.ts`. It:
   1. starts the mock on 18081
   2. starts `cloudflared tunnel --url http://localhost:18081` and reads its `https://` link
   3. starts a second tunnel for port 3000
   4. starts `next dev` with `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` pointing at the mock's tunnel (`wss://`) and mock mode on
   5. prints the page link to open on the iPhone
   6. stops everything on Ctrl+C

   The root `dev.ts` is captain-owned and stays unchanged.
3. **Next.js allow-list.** In `client-frontend/next.config.ts` (our file), add `allowedDevOrigins: ["*.trycloudflare.com"]` so Next dev serves its scripts to the tunnel address. This only affects dev.
4. **Evidence.** `.devcontext/evidence/audio-client/iphone-<date>.md`, filled in from the checklist below. It records the iOS version, iPhone model, network, what passed, what failed, and exact observations.
5. **Fixes.** Anything the iPhone exposes gets fixed with a unit test where possible, and the gate is rerun.

## Setup (asks before installing)

- `brew install cloudflared` (approved).
- The iPhone uses any network (the tunnel goes through the internet). The laptop must stay awake while testing.

## iPhone checklist

| # | Check | Pass looks like |
| --- | --- | --- |
| 1 | Open the link | "Device N", "Connected" |
| 2 | Reload, or close and reopen Safari | Same device number |
| 3 | Tap Enable sound | "Audio unlocked" ✓, "Assets verified (4/4)" ✓ |
| 4 | Assign a channel and play (mock command) | The tone plays from the iPhone speaker at the countdown |
| 5 | Same, with the silent switch on silent | Still plays (tests change 1) |
| 6 | Volume buttons during play | Volume changes; nothing breaks |
| 7 | Switch channel mid-song | Tone changes without restarting |
| 8 | Pause, seek, play, panic | As on desktop; panic cuts instantly |
| 9 | Swipe to another app for 10 s, come back | Shows "Tap to resume sound" or resumes; readiness is honest; plays again after a tap |
| 10 | Lock the screen during play, unlock | Same as 9; the lease stops sound within about 10 s if the socket dropped |
| 11 | Incoming call or Siri during play (if practical) | Audio `interrupted`; "Tap to resume sound" |
| 12 | Calibration: `/__mock__/calibrate` with the page open | Countdown, about 11 s amber/blue flash filling the screen, then "Calibration: done"; the screen doesn't dim |
| 13 | Film 12 with another phone or a laptop camera (optional) | A short clip for Team 3, stored outside Git, described in the evidence |
| 14 | Turn Wi-Fi off and on during play | "Reconnecting", then back with the same device |

## Tests

- `AudioContextHost`: audio session type set to "playback" when available, and skipped when absent (fake navigator).
- The tunnel script's link parsing, tested as a pure function on sample `cloudflared` output.
- `bun run gate:client`.

## Not covered by this slice

- **Sync between phones.** The mock mode uses each phone's own clock. Real sync and the two-minute timing measurement wait for Team 1's clock and a second phone.
- **Android.** No Android device is available.
- **Venue network, many phones, and a real deployment.** These belong to Team 1 and rehearsal.

## Review decisions (2026-09-19)

1. Tunnel: install `cloudflared` with Homebrew.
2. Link: printed only; the user AirDrops or messages it to the iPhone. No QR dependency.
