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

The join/socket behavior is a proposal for Team 1, listed in `.devcontext/teams/audio-client/handoff.md`. The real-HTTP/WebSocket test is `client-frontend/tests/mock-server.test.ts`.
