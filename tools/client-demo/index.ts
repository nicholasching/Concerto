import { startClientDemoServer } from "./server";
const server = startClientDemoServer({ port: 18081 });
console.log(`SYNTHETIC client harness (join/resume): ${server.url}`);
