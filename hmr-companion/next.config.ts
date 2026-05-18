import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
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
