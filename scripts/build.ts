import { createRequire } from "node:module";
import { resolve } from "node:path";
import { ROOT, run } from "./run";

export function nextCli(app: string) {
  return createRequire(resolve(ROOT, app, "package.json")).resolve("next/dist/bin/next");
}
export function nextRuntime() {
  const node = Bun.which("node");
  if (!node) throw new Error("Install Node.js 22 or later to run the Next frontends and their WebSocket proxy.");
  return node;
}
export async function build(target: string) {
  if (target === "all" || target === "sync") {
    const result = await Bun.build({ entrypoints: [resolve(ROOT, "backend/src/index.ts")], outdir: resolve(ROOT, "backend/dist"), target: "bun" });
    if (!result.success) throw new Error(result.logs.join("\n"));
    console.log("Backend shell built.");
  }
  for (const [team, app] of [["client", "client-frontend"], ["admin", "admin-frontend"]]) {
    if (target === "all" || target === team) await run([process.execPath, nextCli(app), "build", app, "--webpack"]);
  }
}
if (import.meta.main) await build(process.argv[2] ?? "all");
