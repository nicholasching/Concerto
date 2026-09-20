# Protocol v1 handoff

Authoring source: `packages/contracts/src/models.ts` and `messages.ts`. Generated consumer registry: `packages/contracts/generated/schemas.json`. TypeScript imports `@orchestra/contracts`; Python uses `otc.validation.validate_schema(name, value)`. Generator uses JSON Schema draft-07.

Messages are strict objects with `protocolVersion`, `sessionId`, `serverEpoch`, `messageId`, `type`, and typed `payload`. Server state/scheduled messages also carry `revision` and, where relevant, `effectiveServerMs`. Additional unknown fields are rejected. `ServerMessage` includes `error` and `lease.renew` as well as the preparation/commit events listed in the plan.

Use the exported request schemas for join, assignments, transport, mix, show, panic, calibration creation/arming, worker-job creation, and map commit. Scheduled mutation acknowledgements use `CommandAccepted`; creation/reading uses typed resource schemas (`CalibrationCreated`, `CalibrationResource`, `CameraUploadReceipt`, `JobResource`). Errors use `ApiError`. Asset/video uploads send raw byte streams plus query metadata, capped at 128 MiB audio / 1 GiB video and verified against declared size and computed SHA-256. Never send server-local video paths to participants.

Actor authentication, array uniqueness, cross-object references, role filtering, expected revision checks, authorization, timestamp equality between envelope/payload, and preparation membership are semantic checks for the state owner. Structural schema validation alone does not implement them. Never accept `device.status.deviceId` without comparing it to socket identity.

`Snapshot` is a discriminated union by role. A participant receives only its own readiness, assignment, and location along with relevant show/transport state. Admin receives the full registry/map. Pending actions have independent transport/assignment/mix domains; a new mix revision does not cancel a scheduled play.

The integrated real backend owns all concert routes. `expectedRevision` is domain-specific: show.showRevision, assignmentRevision, highest effective/pending transportRevision or mixRevision. Map selections also carry mapRevision. Admin snapshots expose readiness barriers, current run/upload/flash reports and applied command IDs; both roles receive effective mix and pending state.

`POST /api/assignments/prepare` takes AssignmentRequest and returns preparationId. For a live non-null channel switch, commit must carry that preparationId and the same selection/channel/revisions. Only ready devices switch; exclusions are returned explicitly. Routing while silent may include offline devices; the later transport preparation gates sound. Disconnection invalidates outstanding readiness.

`PATCH /api/calibrations/:runId/uploads/:uploadId` updates column/rotation/anchors/exclusions. An older job cannot commit after its geometry changes. `GET /api/jobs/:jobId/debug/camera-N.png` returns authenticated review artifacts. Cue markers are optional saved-show metadata. OTC packet/codebook semantics remain unchanged.

Stage UI addition (2026-09-19): participant snapshots optionally include `calibrationStage` (`waiting`, `calibrating`, `processing`, `complete`). This enables manual section choice only after a finished calibration. Refresh older strict-schema clients when deploying the updated producer. Generated JSON Schema is updated; optical packet and worker schemas are unchanged. `POST /api/reset` is operator-only, guards session/epoch, rotates the epoch, and closes participant sockets with code 4002. Clients clear resume identity and stay reset until page reload. See the [workflow ADR](../decisions/20260919-single-domain-stage-workflow.md).
