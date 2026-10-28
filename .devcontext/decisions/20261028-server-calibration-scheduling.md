# Server schedules calibration and restores eligible preparation ACKs

Date: 2026-10-28. Status: accepted by integration captain under explicit user direction. Affects sync-control, audio-client and admin-console.

Calibration arm no longer depends on an operator clock estimate. The server chooses now + 5000 ms after validating the current run/preparation and ready subset. CalibrationArmRequest.effectiveServerMs becomes optional for compatibility with old dashboards and is ignored; the response and arm broadcast carry the authoritative chosen timestamp. Existing command identity/replay and session/epoch checks remain.

The internet profile admits minimum RTT <=750 ms (uncertainty <=375 ms); strict remains <=40 ms and freshness/warmup/pair filtering remain unchanged. This is a participation policy, not an acoustic accuracy guarantee, and BeatSync's 750 ms warning is not a precision guarantee.

Eligible status reports replay the exact still-created preparation when the phone's ACK is missing. This covers clock/foreground recovery and reconnect without resurrecting armed/closed runs or explicit opt-outs. Calibration ACKs after arm are rejected. The dashboard shows why starting is disabled and never checks operator clock quality for calibration start.

No wire message types change; generated request schema is updated. Transport/mix scheduling is unchanged. Tests and production evidence are recorded in the integration journal.

The first public 250-client test delivered all arms, but generated 127211 probes in 62.6 seconds and some clocks degraded under continued media load. Follow-up: permit one outstanding coded pair; wait for its reply using observed RTT (bounded 250–3750 ms, 1000 ms initially), back off rejected/timed-out pairs with jitter (up to 500 ms), and use steady pacing after the 16-measurement window fills even if admission fails. The estimator and quality thresholds are unchanged. This removes the fixed 50 ms decision that incorrectly treated normal slow replies as missing. The public retest must execute the real FlashRenderer timing/clock gates for the whole 11.75-second pattern while media downloads continue.

Final pacing revision supersedes the single-pair restriction above: the full-pattern WAN test demonstrated sample-age expiry despite acceptable RTT when jitter rejected repeated pairs. Use at most four outstanding pairs, a 250 ms warmup/recovery cadence (75..250 ms adaptive warmup on fast replies), steady 2500 ms cadence after warmup and fresh success, and bounded RTT-based response timeouts. Correlate first measurements by group ID in a map and discard timed-out groups. Preserve the 5 ms purity filter and ten-second freshness policy. A fake-network regression at 750 ms RTT rejecting five of every six pairs must remain ready for a full minute after warmup, while traffic stays bounded.
