import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
const backend = (process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const config: NextConfig = {
  transpilePackages: ["@orchestra/audio", "@orchestra/contracts", "@orchestra/sync"],
  devIndicators: false,
  allowedDevOrigins: ["*.trycloudflare.com", ...(process.env.DEV_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean)],
  outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  async rewrites() {
    // Expose audience operations only. Operator APIs and camera uploads use the local console.
    return [
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
