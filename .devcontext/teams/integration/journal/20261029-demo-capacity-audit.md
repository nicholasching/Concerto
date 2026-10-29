# Demo capacity audit — 2026-10-29

Owner: integration captain. Baseline: `3d08a6d`, branch `codex/stage-calibration-reliability`; clean working tree at start.

## Scope and constraints

User requests a full codebase/infrastructure audit for up to 250 audience devices before tomorrow's demo. Preserve the explicit request to stop Railway testing and conserve quota: no new production load, participant sessions, media downloads, or polling. Existing public 250-client evidence is admissible but is not a venue Wi-Fi, physical display, camera, or acoustic guarantee. Read-only Railway configuration inspection is within scope.

Audit as integration captain across the merged four-team implementation. No parallel agents or ownership transfers; initially review only. Keep the reference tree unchanged. Do not change the previously discussed ten-second calibration clock policy without recording a concrete decision and regression evidence.

## Plan and acceptance

1. Trace join/authentication, socket/probe/telemetry fanout, preparation/cue execution, audio preload, upload/worker resource isolation, persistence/restart, and deployment settings. Identify bottlenecks and precise failure conditions at 250.
2. Run current local software gates and bounded local load/E2E checks. Record failures and limits without weakening assertions. Production traffic remains stopped.
3. Produce a severity-ranked readiness report, capacity/bandwidth calculations, and concrete demo runbook. Separate observed configuration, historical measurements, new local evidence, and unverified physical requirements. Fix only confirmed bounded demo blockers if necessary, with focused verification.

## Running evidence

- Baseline is clean; deployed release and existing 250-client report match the previous release handoff.
- Existing public test: 245 modeled eligible devices completed the full calibration; five deliberately over-limit devices excluded; 500 finite audio transfers, 512,022,000 total bytes. This is short synthetic network/load evidence, not a measurement using the production music set.
- Read-only Railway UI inspection failed twice at `Emulation.setFocusEmulationEnabled`, failed again after session reset, then native computer use stopped because the current browser URL could not be verified for policy enforcement. Stopped computer use; no settings changed. Current service CPU/RAM, volume free space and quota cutoff remain unverified. No Railway CLI is installed. Did not inspect browser credentials or call private APIs as a workaround.
- Root gate: shared contract/fixture/boundary/type/lint checks PASS; 19 contract + 249 sync + 161 client + 31 admin tests PASS; backend and both Next builds PASS; Ruff PASS. Full Python suite **164 PASS / 9 FAIL**, 255.53 seconds. Root gate exit 1 retained. Eight failures concern optical recovery/crossing expectations; one Windows CLI error JSON included extra multiprocessing teardown diagnostics. No source changes preceded these failures.
- Focused optical rerun with budget 3 and all three production native-thread caps: v2 faint-colors and crossing assertions still FAIL, malformed-video CLI PASS (2 failed / 1 passed, 14.85 seconds). Faint-colors recovered {0,3}/6; crossing localized an ID the negative test excludes. Do not infer an actual identity swap from that assertion alone; reconcile evidence with the valid-code acceptance ADR before runtime/test changes.
- Local seven-scenario real HTTP/WS/hash/media/generated MP4/real Python/map/four-lane routing/playback/Panic/restart E2E PASS, 21.8 seconds. Used a byte-for-byte harness copy with only its output report path changed so historical committed evidence remains intact. Analysis budget 3/native thread caps applied.
- Local full 250-client / 300-second control load PASS: all joins/prepared ACKs/cues, 25 reconnects, 250 assignments, zero errors/retries; synthetic CPU-active worker complete. Loop p99 14.86 ms, max 71.34 ms; join wave 88 ms / all sockets 186 ms. Other local checks overlapped part of this run; no isolated capacity or physical inference. No new Railway traffic.
- Reproduction script `runtime/demo-capacity-audit/characterize.ts` proves playback ACK loss persists after readiness recovery (Play NOBODY_READY until re-prepare); 501 ms operator command transit/queue loss rejects its two-second cue against the 1500 ms minimum; transient asset 503 needs an explicit second preload. No implementation or assertion was changed to obtain these results.
- Local show metadata only (no credentials/tokens copied): 3 stereo 48 kHz MP3 tracks / 26.05 MiB encoded / ~299.86 MiB decoded per phone, versus the prior public test's ~1 MiB tone. Calculated 6.36 GiB for 250 uncached phones; ideal 182 Mbit/s useful shared throughput for a five-minute preload. This is not a fresh production show observation or venue measurement.
- Snapshot characterization with 1262 retained identities: 501562 encoded bytes, build+serialize p50 3.47 ms / p99 10.30 ms (200 local iterations). Full operator push 2 Hz plus UI polling 1 Hz can cost significant raw traffic per open admin tab. No actual Railway egress measurement claimed.
- Final report: [250-device readiness audit](../../../evidence/integration/20261029-demo-capacity-audit.md). Canonical new small load/E2E/characterization reports stored beside it; raw logs/reproduction scripts remain ignored. Reference diff against foundation-v1 empty; no runtime source/config/dependency changes, no push/redeploy/reset. All local test processes exited; no listeners on the owned E2E/load ports remain.

## Handoff

Audit complete, **conditional capacity evidence / no unconditional demo sign-off**. Next priorities: server-owned performance timing, exact playback/assignment ACK recovery, optical failure triage without weakened assertions, music retry/memory/preload plan, and current Railway allocation/storage/credit verification. Keep production testing stopped unless the user explicitly authorizes a new bounded test. Physical rehearsal with the approved show/current build/venue network remains required.
