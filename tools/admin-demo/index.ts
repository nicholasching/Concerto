// Admin demo helper. The fake-input harness has been removed; the admin console now talks to the
// real control server (default http://localhost:8080). This script is a standalone status check:
// it pings the real server and reports whether it is up, so you know whether the console will
// show live data or "Real server not detected" messages. Run with `bun run tools/admin-demo/index.ts`.
//
// The console itself is started by `bun run dev:admin-demo` (Next.js on port 3001). When the real
// server is not running, every console action attempts the real call and shows a clean
// "Real server not detected" error in its catch block — nothing is faked.

export {};

const url = process.env.ORCHESTRA_API_URL ?? "http://localhost:8080";

try {
  const response = await fetch(`${url}/api/health`);
  if (response.ok) {
    const body = await response.json().catch(() => ({}));
    console.log(`Real server detected at ${url}: ${JSON.stringify(body)}`);
    console.log("The admin console will show live data. Open http://localhost:3001");
  } else {
    console.log(`Real server at ${url} responded HTTP ${response.status}.`);
    console.log("The admin console will show this error on every action. Open http://localhost:3001");
  }
} catch {
  console.log(`Real server not detected at ${url}.`);
  console.log("The admin console is still runnable at http://localhost:3001 — every action will");
  console.log('retry the real server and show "Real server not detected" until it is running.');
  console.log("To get live data, start the real control server (Team 1, port 8080).");
}
