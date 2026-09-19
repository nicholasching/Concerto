import { nextCli } from "./build";
import { ROOT } from "./run";

// Real HTTP startup of the built shells, using private test ports.
const children: ReturnType<typeof Bun.spawn>[] = [];
try {
  children.push(Bun.spawn([process.execPath, "backend/dist/index.js"], { cwd: ROOT, env: { ...process.env, PORT: "18080" }, stdout: "ignore", stderr: "inherit" }));
  for (const [app, port] of [["client-frontend", "13000"], ["admin-frontend", "13001"]]) children.push(Bun.spawn([process.execPath, nextCli(app), "start", app, "--port", port], { cwd: ROOT, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdout: "ignore", stderr: "inherit" }));
  for (const [index, port, path, expected] of [[0, 18080, "/api/health", "foundation"], [1, 13000, "/", "FOUNDATION SHELL"], [2, 13001, "/", "FOUNDATION SHELL"]] as const) {
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
    console.log(`PASS: built shell on ${port}`);
  }
} finally {
  for (const child of children) child.kill();
  await Promise.all(children.map(child => child.exited));
}
