# Captain review

Baseline: 0ae3487. User authorized review/fixes before integration.

Focused gate passed (185 tests plus contract checks). Review reproduced missing initial WebSocket snapshots, unfiltered pending assignments, and acceptance of old-epoch status. Fix these on this branch and add regression coverage; shared contract and preparation workflow changes follow on main. Physical evidence remains outstanding.

Verification: gate:sync passes after fixes: 188 tests plus 14 contracts, lint, typecheck, drift checks and backend build. New real subprocess/socket test verifies participant and operator initial snapshots. Pending assignments are role-filtered; stale epoch status is refused; replaced sockets cannot mutate state; WebSocket message size is bounded. An initial union-inference type error in the regression change was corrected before the passing run.
