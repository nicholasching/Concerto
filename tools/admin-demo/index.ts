import { startMockServer } from "@orchestra/testkit/mock-server";
const server = startMockServer(18084, 1500);
console.log(`SYNTHETIC 1500-device admin harness: ${server.url}`);
