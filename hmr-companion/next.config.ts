import type { NextConfig } from "next";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");

const appDir = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";

// Monorepo: shared `.env.local` at repo root (parent) — e.g. NEXT_PUBLIC_MAPTILER_KEY.
// App-local env in `hmr-companion/` overrides parent values.
loadEnvConfig(path.join(appDir, ".."), isDev);
loadEnvConfig(appDir, isDev);

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: "50mb",
  },
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/better-sqlite3/**/*"],
  },
  turbopack: {
    root: appDir,
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Service-Worker-Allowed", value: "/" }],
      },
    ];
  },
  /** Windy risolve `img/...` sotto `/track/:id/meteo` → 404; proxy verso asset ufficiali. */
  async rewrites() {
    return [
      {
        source: "/track/:slug/img/:path*",
        destination: "https://www.windy.com/img/:path*",
      },
    ];
  },
};

export default nextConfig;
