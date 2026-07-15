import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextDir = path.join(root, ".next");

if (fs.existsSync(nextDir)) {
  fs.rmSync(nextDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log("Removed .next");
} else {
  console.log(".next already absent");
}

console.log("Cache pulita — avvia con: npm run dev");
