# Protocol v1 handoff

Authoring source: `packages/contracts/src/models.ts` and `messages.ts`. Generated consumer registry: `packages/contracts/generated/schemas.json`. TypeScript imports `@orchestra/contracts`; Python uses `otc.validation.validate_schema(name, value)`. Generator uses JSON Schema draft-07.

Messages are strict objects with `protocolVersion`, `sessionId`, `serverEpoch`, `messageId`, `type`, and typed `payload`. Server state/scheduled messages also carry `revision` and, where relevant, `effectiveServerMs`. Additional unknown fields are rejected. `ServerMessage` includes `error` and `lease.renew` as well as the preparation/commit events listed in the plan.

Use the exported request schemas for join, assignments, transport, mix, show, panic, calibration creation/arming, worker-job creation, and map commit. HTTP success mutations use `CommandAccepted`; errors use `ApiError`. Asset/video uploads are multipart transports: backend owns streaming/limits; camera metadata becomes a validated `CameraInput` only after hashing completed uploads. Never send server-local video paths to participants.

Actor authentication, array uniqueness, cross-object references, role filtering, expected revision checks, authorization, timestamp equality between envelope/payload, and preparation membership are semantic checks for the state owner. Structural schema validation alone does not implement them. Never accept `device.status.deviceId` without comparing it to socket identity.

`Snapshot` is a discriminated union by role. A participant receives only its own readiness, assignment, and location along with relevant show/transport state. Admin receives the full registry/map. Pending actions have independent transport/assignment/mix domains; a new mix revision does not cancel a scheduled play.

The real backend currently implements health/foundation info only. The loopback mock's supported operations are documented in `packages/testkit/README.md`; it intentionally does not implement production authentication, joins, assignments, barriers, or persistence.
