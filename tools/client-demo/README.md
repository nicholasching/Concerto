# Participant harness - Team 2

`bun run dev:client-demo` starts this loopback mock on 18081 and Next on 3000. It is SYNTHETIC and never imported by production code.

`server.ts` (Team 2-owned; reuses testkit fixtures) supports:

| Route | Behavior |
| --- | --- |
| `POST /api/sessions/demo/join` | `{}` allocates IDs 0, 1, 2… (never reused); `{ resumeToken }` resumes. 401 unknown token, 409 at capacity (default 30) |
| `WS /ws?token=…` | Unknown token refused. Sends the device's `state.snapshot` on open. A second socket for the same token closes the first with 4001. Answers `clock.probe`. Validates `device.status` and closes with 1008 if its deviceId isn't the socket's |
| `GET /api/assets/tone-0..3` | Original hashed WAV fixtures |
| `POST /__mock__/drop` | Close every socket, keep identities |
| `POST /__mock__/restart` | New `serverEpoch`, keep identities, close every socket |
| `GET /__mock__/devices` | Last reported readiness per joined device |
| `POST /__mock__/calibrate?leadMs=3000&readyWaitMs=1000` | Sends `calibration.prepare` (new run ID, next run tag, `amber-blue-v1`) to connected devices, then after `readyWaitMs` arms the ready ones to start `leadMs` later. 409 with nobody connected |
| `GET /__mock__/calibration` | Each run's participants, ready/not-ready replies and `calibration.result`s |

| `POST /__mock__/assign?deviceId=0&channelId=channel-1&leadMs=2000` | `assignment.prepare` to that device, then `assignment.commit` after `readyWaitMs` (default 500). `channelId=none` clears |
| `POST /__mock__/transport?action=play\|pause\|seek\|stop&positionMs=0&leadMs=2000` | `transport.prepare` to all, then `transport.commit`. Play without `positionMs` resumes from the current position |
| `POST /__mock__/mix?masterGain=0.5&mute=channel-2&unmute=…&solo=…&unsolo=…` | `mix.commit` to all |
| `POST /__mock__/panic` | `panic` to all; the snapshot's transport becomes a new stopped revision |
| `POST /__mock__/lease?paused=1` | Stops the automatic `lease.renew` (sent on connect and every 3 s, 10 s expiry). `paused=0` resumes |
| `POST /__mock__/assets` | `assets.prepare` with the current show |
| `GET /__mock__/playback` | Transport, assignments, pending actions, ready replies, lease state |

In zsh, quote URLs that contain `?`, for example `curl -X POST 'localhost:18081/__mock__/panic'`.

The join/socket behavior is a proposal for Team 1, listed in `.devcontext/teams/audio-client/handoff.md`. The real-HTTP/WebSocket test is `client-frontend/tests/mock-server.test.ts`.
