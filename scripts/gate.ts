import { build } from "./build";
import { run } from "./run";

const target = process.argv[2] ?? "all";
if (!["all", "sync", "client", "admin", "otc"].includes(target)) throw new Error(`Unknown gate: ${target}`);
console.log(`FOUNDATION gate: ${target}. Feature/hardware acceptance remains in team stage briefs.`);
for (const task of ["contracts:check", "fixtures:check", "check:boundaries", "typecheck", "lint", "test:contracts"]) await run([process.execPath, "run", task]);
const teams = target === "all" ? ["sync", "client", "admin", "otc"] : [target];
for (const team of teams) {
  if (team === "otc") await run([process.execPath, "run", "test:otc"]);
  else {
    const tests = team === "sync" ? ["./backend/tests", "./packages/sync/tests", "./packages/testkit/tests", "./tools/load/tests", "./tools/deploy/tests"] : [`./${team === "client" ? "client" : "admin"}-frontend/tests`, `./packages/${team === "client" ? "audio" : "selection"}/tests`];
    await run([process.execPath, "test", ...tests]);
    await build(team);
  }
}
console.log(`PASS: ${target} foundation gate.`);
