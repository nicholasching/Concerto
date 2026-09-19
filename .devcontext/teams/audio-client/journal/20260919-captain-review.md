# Captain review

Baseline: e91075b. User authorized review/fixes before integration. Baseline gate passed.

Found production socket query mismatch, stale-epoch event acceptance, and telemetry snapshots rebuilding all playing source nodes. Correct protocol authentication and epoch filtering here, retain playback for unchanged authoritative state, and reset playback revision/lease state on epoch replacement. Add regressions and rerun gate:client. The real clock/manual-column/mix recovery require shared integration on main.

Verification: gate:client passes after fixes (110 focused tests, 14 contracts, lint/typecheck/schema/fixtures/boundaries, production build). Regression changes initially exposed the need for an explicit disconnected() lifecycle: connection loss now silences playback, drops the old lease and forces authoritative reload on reconnect. Attaching an engine first settles due mix state. These were fixed and the full gate rerun successfully.
