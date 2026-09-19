import { expect, test } from "bun:test";
import { parseTunnelUrl } from "../../tools/client-demo/phone";

test("finds the quick tunnel link in cloudflared's log", () => {
  const log = `2026-09-19T12:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...
2026-09-19T12:00:02Z INF +--------------------------------------------------------------------------------------------+
2026-09-19T12:00:02Z INF |  https://brave-orange-tiger-12.trycloudflare.com                                           |
2026-09-19T12:00:02Z INF +--------------------------------------------------------------------------------------------+`;
  expect(parseTunnelUrl(log)).toBe("https://brave-orange-tiger-12.trycloudflare.com");
});

test("ignores the API host and returns null before a link appears", () => {
  expect(parseTunnelUrl("INF Requesting new quick Tunnel on trycloudflare.com...")).toBeNull();
  expect(parseTunnelUrl("ERR failed to request quick Tunnel: Post https://api.trycloudflare.com/tunnel")).toBeNull();
  expect(parseTunnelUrl("ERR https://api.trycloudflare.com/tunnel\nINF |  https://calm-sea-1.trycloudflare.com  |")).toBe("https://calm-sea-1.trycloudflare.com");
});
