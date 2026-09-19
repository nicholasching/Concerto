import { cpSync, existsSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ROOT, run } from "./run";

const destination = resolve(ROOT, "runtime/isolation", String(Date.now()));
mkdirSync(destination, { recursive: true });
const omitted = new Set(["node_modules", ".next", "next-env.d.ts", "dist", ".venv", "__pycache__", ".pytest_cache", ".ruff_cache"]);
for (const name of ["backend", "client-frontend", "admin-frontend", "packages", "workers", "tools", "scripts", "types", "fixtures", "package.json", "bun.lock", "tsconfig.json", "eslint.config.mjs"]) {
  cpSync(join(ROOT, name), join(destination, name), { recursive: true, filter: source => !omitted.has(basename(source)) && !source.endsWith(".egg-info") && !source.endsWith(".tsbuildinfo") });
}
if (existsSync(join(destination, "beatsync-source"))) throw new Error("Isolation copy contains reference source");
console.log(`Source-free validation workspace: ${destination}`);
await run([process.execPath, "install", "--frozen-lockfile"], destination);
await run([process.execPath, "run", "setup:python"], destination);
await run([process.execPath, "run", "gate"], destination);
console.log("PASS: complete foundation gate without beatsync-source. Output retained in ignored runtime/isolation.");
