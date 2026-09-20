import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { nextCli, nextRuntime } from "./build";
import { ROOT } from "./run";

function localPort(value: string, name: string): number {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port) {
    throw new Error(`${name} must be a loopback HTTP URL with an explicit port for this single-service deployment.`);
  }
  return Number(url.port);
}

export function productionConfiguration(env: Record<string, string | undefined>) {
  if (!env.OPERATOR_SECRET || env.OPERATOR_SECRET === "local-demo-only") throw new Error("Set a production OPERATOR_SECRET before starting the service.");
  const port = Number(env.PORT ?? 3000);
  const backendPort = localPort(env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8080", "BACKEND_INTERNAL_URL");
  const adminPort = localPort(env.ADMIN_INTERNAL_URL ?? "http://127.0.0.1:3001", "ADMIN_INTERNAL_URL");
  if (![port, backendPort, adminPort].every(value => Number.isInteger(value) && value > 0 && value <= 65535)
    || new Set([port, backendPort, adminPort]).size !== 3) throw new Error("Public, backend and admin ports must be valid and distinct.");
  const data = resolve(env.DATA_DIR ?? resolve(ROOT, "runtime/production"));
  return { port, backendPort, adminPort, data, env: { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    SESSION_ID: env.SESSION_ID ?? "prod-session", CHECKPOINT_PATH: resolve(data, "checkpoint.json"),
    ASSETS_PATH: resolve(data, "assets"), UPLOADS_PATH: resolve(data, "uploads"), JOBS_PATH: resolve(data, "jobs") } };
}

export async function startProduction(env = process.env) {
  const config = productionConfiguration(env);
  for (const file of ["backend/dist/index.js", "client-frontend/.next/BUILD_ID", "admin-frontend/.next/BUILD_ID"]) {
    if (!existsSync(resolve(ROOT, file))) throw new Error(`Missing production build: ${file}. Run bun run build first.`);
  }
  const python = env.PYTHON ?? resolve(ROOT, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
  if (!existsSync(python)) throw new Error("Python worker environment missing. Run bun run setup:python before deploying.");
  await mkdir(config.data, { recursive: true });
  const children: ReturnType<typeof Bun.spawn>[] = [];
  let stopping = false;
  const stop = () => { stopping = true; for (const child of children) child.kill(); };
  const spawn = (command: string[], childEnv: Record<string, string>) => children.push(Bun.spawn(command, {
    cwd: ROOT, env: { ...config.env, PYTHON: python, ...childEnv }, stdin: "ignore", stdout: "inherit", stderr: "inherit",
  }));
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try {
    spawn([process.execPath, "backend/dist/index.js"], { HOST: "127.0.0.1", PORT: String(config.backendPort) });
    spawn([nextRuntime(), nextCli("admin-frontend"), "start", "admin-frontend", "--hostname", "127.0.0.1", "--port", String(config.adminPort)], {});
    spawn([nextRuntime(), nextCli("client-frontend"), "start", "client-frontend", "--hostname", "0.0.0.0", "--port", String(config.port)], {});
    console.log(`Production service listening on ${config.port}; persistent data: ${config.data}`);
    const exited = await Promise.race(children.map(async (child, index) => ({ index, code: await child.exited })));
    if (!stopping) console.error(`Application ${exited.index} exited (${exited.code}); stopping this deployment.`);
    return stopping ? 0 : exited.code || 1;
  } finally {
    stop();
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    const timeout = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); }, 5000);
    timeout.unref();
    await Promise.all(children.map(child => child.exited));
    clearTimeout(timeout);
  }
}

if (import.meta.main) process.exitCode = await startProduction();
