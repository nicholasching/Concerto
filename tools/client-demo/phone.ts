// Phone testing: the Team 2 mock and the participant page behind two temporary HTTPS tunnels.
// SYNTHETIC mock, dev only. Run from the repository root: bun tools/client-demo/phone.ts
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Subprocess } from "bun";
import { startClientDemoServer } from "./server";

const ROOT = resolve(import.meta.dir, "../..");
const MOCK_PORT = 18081;
const PAGE_PORT = 3000;

/** The public https link a Cloudflare quick tunnel prints, or null. */
export function parseTunnelUrl(text: string): string | null {
  // Skip cloudflared's own API host, which can appear in error lines before the real link.
  return text.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? null;
}

async function openTunnel(port: number): Promise<{ url: string; process: Subprocess }> {
  const tunnel = Bun.spawn(["cloudflared", "tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdout: "ignore", stderr: "pipe" });
  const reader = (tunnel.stderr as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value);
    const url = parseTunnelUrl(seen);
    if (url) {
      // Keep draining the log so the tunnel never blocks on a full pipe.
      void (async () => { while (!(await reader.read()).done) { /* discard */ } })();
      return { url, process: tunnel };
    }
  }
  tunnel.kill();
  throw new Error(`cloudflared gave no tunnel link for port ${port}. Is it installed (brew install cloudflared)?\n${seen.slice(-800)}`);
}

async function main() {
  const mock = startClientDemoServer({ port: MOCK_PORT });
  const children: Subprocess[] = [];
  const stop = () => { for (const child of children) child.kill(); mock.stop(true); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const api = await openTunnel(MOCK_PORT);
  children.push(api.process);
  const page = await openTunnel(PAGE_PORT);
  children.push(page.process);

  const next = createRequire(resolve(ROOT, "client-frontend/package.json")).resolve("next/dist/bin/next");
  children.push(Bun.spawn([process.execPath, next, "dev", "client-frontend", "--webpack", "--port", String(PAGE_PORT)], {
    cwd: ROOT, stdin: "inherit", stdout: "inherit", stderr: "inherit",
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_API_URL: api.url,
      NEXT_PUBLIC_WS_URL: `${api.url.replace(/^https/, "wss")}/ws`,
      NEXT_PUBLIC_ENABLE_MOCKS: "1",
    },
  }));

  console.log(`
SYNTHETIC phone test (mock server, local fixture clock)
  Open on the iPhone:  ${page.url}
  Mock API tunnel:     ${api.url}
  Mock controls on this laptop, for example:
    curl -X POST 'localhost:${MOCK_PORT}/__mock__/assign?deviceId=0&channelId=channel-1'
    curl -X POST 'localhost:${MOCK_PORT}/__mock__/transport?action=play&positionMs=0'
    curl -X POST 'localhost:${MOCK_PORT}/__mock__/calibrate'
  The first page load compiles for a few seconds. Ctrl+C stops everything.
`);
}

if (import.meta.main) await main();
