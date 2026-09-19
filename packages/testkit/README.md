# Shared development test kit

Owner: integration captain. Never import into production application code. Branch-specific scenarios belong in tools/client-demo or tools/admin-demo.

src/index.ts exports createDemoSnapshot(count), participantSnapshot(snapshot, deviceId), and FakeClock. Count 1..2048; IDs start at zero. Synthetic localized/coarse/ambiguous/unseen examples; no audio-ready fixture phones by default.

src/mock-server.ts exports startMockServer(port, count), binding 127.0.0.1. HTTP responses carry X-Orchestra-Mock: 1.

| Route | Behavior |
| --- | --- |
| GET /api/health | Explicit mock/synthetic status |
| GET /__mock__/state | Fixture admin snapshot/live epoch |
| GET /api/sessions/demo/snapshot?role=participant&deviceId=0 | Own snapshot; omit role for admin |
| GET /api/assets/tone-0 through tone-3 | Original hashed WAV bytes |
| WS /ws?deviceId=0 | Own snapshot; validated/correlated clock probe/reply |
| POST /__mock__/broadcast | Validates ServerMessage for live session/epoch; broadcasts without authoritative state mutation |
| Other /api/* | Typed 501 MOCK_NOT_IMPLEMENTED |

Fetch live session/epoch before broadcasting; static fixture epochs are rejected. Broadcast reaches every fixture socket: this is a low-level test tool, not production filtering/authorization. No joining, barriers, scheduling, persistence, assignments, uploads or jobs are simulated yet. Extend explicit scenarios as needed.

Use FakeClock in logic tests. gate:sync includes mock HTTP/WS/media behavior tests.
