import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT } from "./run";

const directory = resolve(ROOT, "runtime/load", crypto.randomUUID());
await mkdir(directory, { recursive: true });
const port = "18090", secret = crypto.randomUUID();
const env = { ...process.env, PORT: port, HOST: "127.0.0.1", SESSION_ID: "load-test", OPERATOR_SECRET: secret,
  CHECKPOINT_PATH: `${directory}/checkpoint.json`, ASSETS_PATH: `${directory}/assets`, UPLOADS_PATH: `${directory}/uploads`, JOBS_PATH: `${directory}/jobs`,
  OTC_COMMAND_JSON: JSON.stringify([process.execPath, resolve(ROOT, "tools/load/worker-fixture.ts")]) };
const backend = Bun.spawn([process.execPath, "backend/src/index.ts"], { cwd: ROOT, env, stdout: Bun.file(`${directory}/server.log`), stderr: Bun.file(`${directory}/errors.log`) });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    ready = await fetch(`http://127.0.0.1:${port}/api/health`).then(response => response.ok).catch(() => false);
    if (ready) break; await Bun.sleep(100);
  }
  if (!ready) throw new Error("Isolated load backend failed to start.");
  const run = Bun.spawn([process.execPath, "tools/load/index.ts", ...process.argv.slice(2), "--url", `http://127.0.0.1:${port}`, "--session", "load-test",
    "--clients", "1500", "--duration", "300", "--report", ".devcontext/evidence/integration/load-1500.md"], { cwd: ROOT, env, stdout: "inherit", stderr: "inherit" });
  process.exitCode = await run.exited;
} finally { backend.kill(); }
