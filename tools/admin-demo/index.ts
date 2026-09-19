// Admin fake-input harness entry point. Run with `bun run dev:admin-demo`. Starts the harness on
// 18084 alongside the admin console on 3001. See server.ts for the implementation and README.md.
import { startAdminHarness } from "./server";

const harness = startAdminHarness(18084, 1500);
console.log(`SYNTHETIC admin harness (1500 fake phones): ${harness.url}`);
console.log("No real server, cameras, or phones. All data is synthetic and labeled as such.");
