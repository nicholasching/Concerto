# Server schedules calibration and restores eligible preparation ACKs

Date: 2026-10-28. Status: accepted by integration captain under explicit user direction. Affects sync-control, audio-client and admin-console.

Calibration arm no longer depends on an operator clock estimate. The server chooses now + 5000 ms after validating the current run/preparation and ready subset. CalibrationArmRequest.effectiveServerMs becomes optional for compatibility with old dashboards and is ignored; the response and arm broadcast carry the authoritative chosen timestamp. Existing command identity/replay and session/epoch checks remain.

The internet profile admits minimum RTT <=750 ms (uncertainty <=375 ms); strict remains <=40 ms and freshness/warmup/pair filtering remain unchanged. This is a participation policy, not an acoustic accuracy guarantee, and BeatSync's 750 ms warning is not a precision guarantee.

Eligible status reports replay the exact still-created preparation when the phone's ACK is missing. This covers clock/foreground recovery and reconnect without resurrecting armed/closed runs or explicit opt-outs. Calibration ACKs after arm are rejected. The dashboard shows why starting is disabled and never checks operator clock quality for calibration start.

No wire message types change; generated request schema is updated. Transport/mix scheduling is unchanged. Tests and production evidence are recorded in the integration journal.
