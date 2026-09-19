import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pythonExecutable, ROOT, run } from "./run";

const action = process.argv[2];
if (action === "setup") {
  const bootstrap = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  if (!existsSync(resolve(ROOT, ".venv"))) await run([bootstrap, "-m", "venv", ".venv"]);
  const python = pythonExecutable();
  const lock = "workers/otc/requirements-dev.lock";
  if (existsSync(resolve(ROOT, lock))) {
    await run([python, "-m", "pip", "install", "-r", lock]);
    await run([python, "-m", "pip", "install", "--no-deps", "-e", "./workers/otc"]);
  } else await run([python, "-m", "pip", "install", "-e", "./workers/otc[dev]"]);
} else if (action === "test") {
  await run([pythonExecutable(), "-m", "ruff", "check", "workers/otc"]);
  await run([pythonExecutable(), "-m", "pytest", "workers/otc/tests", "-q"]);
} else if (["validate-manifest", "replay-fixture", "process"].includes(action)) {
  await run([pythonExecutable(), "-m", "otc", action, ...process.argv.slice(3)]);
} else throw new Error("Expected setup, test, validate-manifest, replay-fixture, or process");
