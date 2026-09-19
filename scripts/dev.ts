import { resolve } from "node:path";
import { nextCli } from "./build";
import { ROOT } from "./run";

const mode = process.argv[2];
const children: ReturnType<typeof Bun.spawn>[] = [];
function spawn(args: string[], env: Record<string, string> = {}) {
  children.push(Bun.spawn([process.execPath, ...args], { cwd: ROOT, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env }, stdin: "inherit", stdout: "inherit", stderr: "inherit" }));
}
function frontend(app: string, port: number, mockPort?: number) {
  spawn([nextCli(app), "dev", app, "--webpack", "--port", String(port)], {
    NEXT_PUBLIC_API_URL: `http://localhost:${mockPort ?? 8080}`,
    NEXT_PUBLIC_WS_URL: `ws://localhost:${mockPort ?? 8080}/ws`,
    NEXT_PUBLIC_ENABLE_MOCKS: mockPort ? "1" : "0",
  });
}
if (mode === "sync-demo" || mode === "all") spawn([resolve(ROOT, "backend/src/index.ts")]);
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
