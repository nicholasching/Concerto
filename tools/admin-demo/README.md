# Operator demo helper - Team 4

`bun run dev:admin-demo` starts the admin console (Next.js) on port `3001`, pointed at the real
control server (default `http://localhost:8080`, Team 1).

## No fake harness

The fake-input harness has been removed. The console now talks to the real server only. When the
real server is not running, every action attempts the real call and shows a clean
"Real server not detected at http://localhost:8080" error in its catch block — nothing is faked.
The console is still runnable and clickable; it just has no live data until the real server is up.

`tools/admin-demo/index.ts` is a standalone status checker: run it to ping the real server and
report whether the console will see live data or "not detected" messages.

## Notes

- The console's server interface is `admin-frontend/src/lib/adapter.ts`; it wraps every fetch so a
  missing server becomes `AdapterError(SERVER_UNREACHABLE)`.
- This is not load evidence and not a substitute for the real server (Team 1) or the OTC decoder
  (Team 3). Calibration uploads a real video to the real server, which hands it to the OTC worker.
