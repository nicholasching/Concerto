import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
const config: NextConfig = { transpilePackages: ["@orchestra/contracts", "@orchestra/sync", "@orchestra/selection"], devIndicators: false, outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)) };
export default config;
