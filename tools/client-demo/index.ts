import { startMockServer } from "@orchestra/testkit/mock-server";
const server = startMockServer(18081);
console.log(`SYNTHETIC client harness: ${server.url}`);
