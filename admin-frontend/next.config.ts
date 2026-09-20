import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
const backend = (process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const config: NextConfig = {
  basePath: "/admin", transpilePackages: ["@orchestra/contracts", "@orchestra/sync", "@orchestra/selection"],
  devIndicators: false, outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  allowedDevOrigins: ["htn.nicholasching.ca", "*.trycloudflare.com"],
  async redirects() { return [{ source: "/", destination: "/admin", basePath: false, permanent: false }]; },
  async rewrites() { return [{ source: "/control/:path*", destination: `${backend}/:path*`, basePath: false }]; },
};
export default config;
