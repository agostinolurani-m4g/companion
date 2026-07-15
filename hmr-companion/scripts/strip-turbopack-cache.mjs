import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const turboCache = path.join(root, ".next", "dev", "cache", "turbopack");

if (fs.existsSync(turboCache)) {
  fs.rmSync(turboCache, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
