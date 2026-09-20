import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
const backend = (process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const development = process.env.NODE_ENV === "development";
const config: NextConfig = {
  // Match the encoded-audio ceiling enforced by the editor and backend.
  experimental: { proxyClientMaxBodySize: 128 * 1024 * 1024 },
  basePath: "/admin", transpilePackages: ["@orchestra/contracts", "@orchestra/sync", "@orchestra/selection"],
  devIndicators: false, outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  allowedDevOrigins: ["htn.nicholasching.ca", "*.trycloudflare.com"],
  // Version unhashed dev chunks so a browser/tunnel cannot retain an older contract.
  deploymentId: development ? (process.env.NEXT_DEPLOYMENT_ID ??= `local-${Date.now().toString(36)}`) : undefined,
  async headers() {
    return development ? [{ source: "/_next/:path*", headers: [
      { key: "CDN-Cache-Control", value: "no-store" },
      { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
    ] }] : [];
  },
  async redirects() { return [{ source: "/", destination: "/admin", basePath: false, permanent: false }]; },
  async rewrites() { return [{ source: "/control/:path*", destination: `${backend}/:path*`, basePath: false }]; },
};
export default config;
