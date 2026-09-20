import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
const backend = (process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const admin = (process.env.ADMIN_INTERNAL_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const development = process.env.NODE_ENV === "development";
const config: NextConfig = {
  transpilePackages: ["@orchestra/audio", "@orchestra/contracts", "@orchestra/sync"],
  devIndicators: false,
  allowedDevOrigins: ["*.trycloudflare.com", "htn.nicholasching.ca", ...(process.env.DEV_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean)],
  outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  // A tunnel/browser can retain dev chunks under their unhashed filenames. Version them
  // per dev server and prevent shared caches from retaining subsequent hot updates.
  deploymentId: development ? (process.env.NEXT_DEPLOYMENT_ID ??= `local-${Date.now().toString(36)}`) : undefined,
  async headers() {
    return development ? [{ source: "/_next/:path*", headers: [
      { key: "CDN-Cache-Control", value: "no-store" },
      { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
    ] }] : [];
  },
  async rewrites() {
    // One public origin; operator routes still authenticate at the backend.
    return [
      { source: "/admin/:path*", destination: `${admin}/admin/:path*` },
      { source: "/control/:path*", destination: `${backend}/:path*` },
      { source: "/api/presentation", destination: `${backend}/api/presentation` },
      { source: "/api/camera/:path*", destination: `${backend}/api/camera/:path*` },
      { source: "/api/health", destination: `${backend}/api/health` },
      { source: "/api/session", destination: `${backend}/api/session` },
      { source: "/api/sessions/:sessionId/join", destination: `${backend}/api/sessions/:sessionId/join` },
      { source: "/api/sessions/:sessionId/snapshot", destination: `${backend}/api/sessions/:sessionId/participant-snapshot` },
      { source: "/api/assets/:trackId", destination: `${backend}/api/assets/:trackId` },
      { source: "/ws", destination: `${backend}/ws/participant` },
    ];
  },
};
export default config;
