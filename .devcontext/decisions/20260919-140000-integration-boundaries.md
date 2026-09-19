# Complete the concert boundaries during integration

Date: 2026-09-19. Status: accepted by the integration captain under the user's cross-team integration assignment. Affects all four teams.

## Context

All four branches are merged. The server and UI independently implemented incompatible authentication, revision and resource response assumptions. The client production clock is absent; admin uses snapshot receipt time. Proposed Team 1/2 ADRs identified preparation visibility, effective mix recovery and manual columns. The user clarified that the immediate milestone is working locally; Railway deployment follows later.

## Decision

- Retain protocol v1 packet and identity encoding. Ship the coordinated app together with additive snapshot fields for effective mix, domain revisions, preparation membership/counts, applied command receipts and current calibration. Regenerate schemas and fixtures together; old defaults only support existing foundation examples, not mixed live deployments.
- Use resumeToken for participant WebSocket authentication, x-operator-secret for admin HTTP and operatorSecret for admin sockets. Public session metadata contains no credential.
- expectedRevision is the affected domain revision, including pending revisions. Snapshot telemetry never invalidates unrelated operator commands.
- Add typed calibration creation/resource, camera-upload receipt and job-resource responses. Upload raw bytes with query metadata; do not buffer multipart video in the control process. Job results remain candidates until explicit commit.
- Add participant.column bound to the authenticated device. Store an explicit manual-column location with null coordinates and a new map revision; a later optical result may replace it. A new explicit choice is a manual override, never an optical claim.
- Use the existing ClockEstimator in both browsers through one shared probe lifecycle. No receipt-time clock and no second estimator.
- Default real worker command selects the repository Python environment and passes evidence/job/debug parameters. Generated clips remain synthetic; actual camera uploads are labeled physical by the operator.
- Live non-null assignments use a selection-bound preparation and report ready/excluded subsets. Silent routing remains durable for offline phones; playback still requires transport preparation. Panic persists cancellation after immediately broadcasting silence.
- Optional cue markers belong to the saved show. Operator waveform decoding is isolated from participant audio scheduling. Calibration resources report phone pattern completion; interrupted phones are excluded from the worker participant set. Camera geometry edits invalidate earlier review candidates at commit.

## Verification

Add producer/consumer integration tests over real HTTP/WebSocket and the actual Python CLI; validate both success and stale/error paths. Run all four gates, source isolation, real-browser flows and a socket load run. Record physical phone/camera/acoustic evidence separately. No physical acceptance or Railway deployment is claimed by local software checks.

Supersedes the proposed transport/resource choices in the Team 1 expected-revision/preparation-count and Team 2 manual-column/mix-in-snapshot ADRs; preserve those documents as history.
