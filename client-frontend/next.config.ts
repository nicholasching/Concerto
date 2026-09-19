import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
const config: NextConfig = { transpilePackages: ["@orchestra/contracts"], devIndicators: false, outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)) };
export default config;
