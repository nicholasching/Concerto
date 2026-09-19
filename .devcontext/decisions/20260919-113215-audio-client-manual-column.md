# Let a phone report a self-chosen audience column
Date / author / team: 2026-09-19 / Claude agent for Team 2 / audio-client
Status: proposed
Affected teams: captain (contracts), Team 1 (backend), Team 2 (client), Team 4 (admin map)
Supersedes / superseded by: none

## Context

Masterplan §5.5 and §11 require a fallback for phones that skip or fail optical calibration: "Participants who skip/fail optical calibration can explicitly choose left/center/right; mark that source as manual." The contracts already model the result: a `coarse` `Location` with `mappingMode: "manual-column"`. But no `ClientMessage` or HTTP request lets a phone send that choice, so the client can't implement the fallback. Slice 3 ships "Skip calibration" and waits for this decision before adding the picker.

## Decision (proposed)

Add one participant WebSocket message to protocol v1:

```ts
z.strictObject({ ...envelope, type: z.literal("participant.column"), payload: z.strictObject({ column: Column.nullable() }) })
```

- `column: null` clears the choice.
- The server binds it to the socket's authenticated device, ignoring any device ID in the body.
- The server records it as `status: "coarse"`, `mappingMode: "manual-column"`, `sourceCameraIds: []`, and `decodeScore: null`.
- It must never overwrite an optically localized position from a newer committed map. Team 4 shows it as manual, distinct from optical results (masterplan §4 "Coordinates and selections").
- A newer map commit that localizes the device wins. Choosing a column again after that is allowed and is shown as a manual override.

## Alternatives and consequences

- **HTTP `POST /api/sessions/:sessionId/column`**: this also works. A socket message fits better because the client already sends `device.status` there and the server already binds the socket to a device.
- **Reuse `device.status`**: this mixes a user choice into telemetry that is sent repeatedly. It would also change a shared payload that other teams consume.
- **Client-only picker**: rejected. It would look like it works while doing nothing.

Migration: this is an additive message type, so existing messages don't change. The captain regenerates the JSON Schema and fixtures, and all consumer gates run. After that, Team 2 adds the picker and a test, Team 1 adds the handler and a test (including the anti-spoof check), and Team 4 displays manual columns.
