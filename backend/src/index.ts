import { createApp } from "./app";
const port = Number(process.env.PORT ?? 8080);
const server = Bun.serve({ hostname: process.env.HOST ?? "127.0.0.1", port, fetch: createApp().fetch });
console.log(`Foundation backend: ${server.url}`);
