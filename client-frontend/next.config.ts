import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
const config: NextConfig = { transpilePackages: ["@orchestra/audio", "@orchestra/contracts", "@orchestra/sync"], devIndicators: false, outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)) };
export default config;
