import { nextCli, nextRuntime } from "./build";
import { ROOT } from "./run";
import { resolve } from "node:path";

// Real HTTP startup of the production builds, using private test ports and isolated data.
const children: ReturnType<typeof Bun.spawn>[] = [];
try {
  children.push(Bun.spawn([process.execPath, "backend/dist/index.js"], { cwd: ROOT, env: { ...process.env, PORT: "18080", SESSION_ID: "smoke-test", OPERATOR_SECRET: crypto.randomUUID(), CHECKPOINT_PATH: resolve(ROOT, "runtime/smoke", crypto.randomUUID(), "checkpoint.json") }, stdout: "ignore", stderr: "inherit" }));
  for (const [app, port] of [["client-frontend", "13000"], ["admin-frontend", "13001"]]) children.push(Bun.spawn([nextRuntime(), nextCli(app), "start", app, "--port", port], { cwd: ROOT, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdout: "ignore", stderr: "inherit" }));
  for (const [index, port, path, expected] of [[0, 18080, "/api/health", "audience-orchestra-control"], [1, 13000, "/", "Audience client"], [2, 13001, "/", "Admin console"]] as const) {
    const deadline = Date.now() + 30000;
    let passed = false;
    while (Date.now() < deadline) {
      if (children[index].exitCode !== null) throw new Error(`Port ${port} process exited before readiness`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1000) });
        const body = await response.text();
        if (response.ok && body.includes(expected)) { passed = true; break; }
      } catch { /* The child may still be starting. */ }
      await Bun.sleep(250);
    }
    if (!passed) throw new Error(`Startup check failed on ${port}`);
    console.log(`PASS: production application on ${port}`);
  }
} finally {
  for (const child of children) child.kill();
  await Promise.all(children.map(child => child.exited));
}
