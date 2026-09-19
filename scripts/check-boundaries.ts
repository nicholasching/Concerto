import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "./run";

const skip = new Set(["node_modules", ".next", "dist", "generated"]);
function walk(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => skip.has(entry.name) ? [] : entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]);
}
const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
if (rootPackage.workspaces.some((entry: string) => entry.includes("beatsync") || entry === "*" || entry.includes("**"))) throw new Error("Workspaces include reference source or an overly broad glob");
for (const directory of ["backend", "client-frontend", "admin-frontend", "packages"]) {
  for (const file of walk(join(ROOT, directory)).filter(file => /\.(ts|tsx)$/.test(file))) {
    const path = relative(ROOT, file).replaceAll("\\", "/");
    const text = readFileSync(file, "utf8");
    if (/(?:from|import|require|readFile|Bun\.file)[^\n]*["'`][^\n]*beatsync-source/.test(text)) throw new Error(`Reference-source dependency: ${path}`);
    if (!path.includes("/tests/") && !path.startsWith("packages/testkit/") && /["']@orchestra\/testkit/.test(text)) throw new Error(`Mock dependency on a production path: ${path}`);
  }
}
console.log("Reference-source and production/mock boundaries pass.");
