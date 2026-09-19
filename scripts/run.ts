import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "..");
export async function run(command: string[], cwd = ROOT) {
  console.log(`> ${command.map(value => value.includes(" ") ? JSON.stringify(value) : value).join(" ")}`);
  const child = Bun.spawn(command, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`Command exited ${exitCode}: ${command.join(" ")}`);
}
export function pythonExecutable() {
  const executable = resolve(ROOT, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
  if (!existsSync(executable)) throw new Error("Python environment missing. Run bun run setup:python first.");
  return executable;
}
