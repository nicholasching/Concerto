import { resolve } from "node:path";
import { nextCli, nextRuntime } from "./build";
import { ROOT } from "./run";

const mode = process.argv[2];
const children: ReturnType<typeof Bun.spawn>[] = [];
function spawn(args: string[], env: Record<string, string> = {}, executable = process.execPath) {
  children.push(Bun.spawn([executable, ...args], { cwd: ROOT, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env }, stdin: "inherit", stdout: "inherit", stderr: "inherit" }));
}
function frontend(app: string, port: number, mockPort?: number) {
  spawn([nextCli(app), "dev", app, "--webpack", "--port", String(port)], {
    ...(mockPort ? { NEXT_PUBLIC_API_URL: `http://localhost:${mockPort}`, NEXT_PUBLIC_WS_URL: `ws://localhost:${mockPort}/ws` } : {}),
    NEXT_PUBLIC_SESSION_ID: mockPort ? "demo" : process.env.SESSION_ID ?? "dev-session",
    NEXT_PUBLIC_ENABLE_MOCKS: mockPort ? "1" : "0",
  }, nextRuntime()); // Next's external WebSocket rewrite stalls under Bun 1.3.14 on Windows.
}
if (mode === "sync-demo" || mode === "all") {
  spawn([resolve(ROOT, "backend/src/index.ts")], { OPERATOR_SECRET: process.env.OPERATOR_SECRET ?? "local-demo-only",
    HOST: process.env.HOST ?? "0.0.0.0", CHECKPOINT_PATH: process.env.CHECKPOINT_PATH ?? "runtime/local/checkpoint.json",
    ASSETS_PATH: process.env.ASSETS_PATH ?? "runtime/local/assets", UPLOADS_PATH: process.env.UPLOADS_PATH ?? "runtime/local/uploads", JOBS_PATH: process.env.JOBS_PATH ?? "runtime/local/jobs" });
  console.log("Local concert: audience http://localhost:3000 | operator http://localhost:3001. Default local operator secret: local-demo-only (override with OPERATOR_SECRET).");
}
if (mode === "client-demo") { spawn([resolve(ROOT, "tools/client-demo/index.ts")]); frontend("client-frontend", 3000, 18081); }
else if (mode === "admin-demo") { frontend("admin-frontend", 3001); }
else if (mode === "all") { frontend("client-frontend", 3000); frontend("admin-frontend", 3001); }
else if (mode !== "sync-demo") throw new Error(`Unknown mode: ${mode}`);
function stop() { for (const child of children) child.kill(); }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const exitCode = await Promise.race(children.map(child => child.exited));
stop();
process.exitCode = exitCode;
