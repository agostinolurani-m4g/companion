/**
 * Scarica estratti Geofabrik in data/osm/
 *
 * Uso:
 *   npx tsx scripts/download-geofabrik.ts liechtenstein
 *   npx tsx scripts/download-geofabrik.ts alps
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

const BASE = "https://download.geofabrik.de";

const PACKAGES: Record<string, { url: string; filename: string }[]> = {
  liechtenstein: [
    { url: `${BASE}/europe/liechtenstein-latest.osm.pbf`, filename: "liechtenstein-latest.osm.pbf" },
  ],
  alps: [
    { url: `${BASE}/europe/italy/nord-ovest-latest.osm.pbf`, filename: "italy-nord-ovest-latest.osm.pbf" },
    { url: `${BASE}/europe/italy/nord-est-latest.osm.pbf`, filename: "italy-nord-est-latest.osm.pbf" },
    { url: `${BASE}/europe/switzerland-latest.osm.pbf`, filename: "switzerland-latest.osm.pbf" },
  ],
};

async function download(url: string, dest: string): Promise<void> {
  console.log(`[geofabrik] GET ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download fallito ${res.status} ${url}`);
  }
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
  const mb = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1);
  console.log(`[geofabrik] Salvato ${dest} (${mb} MB)`);
}

async function main() {
  const key = process.argv[2]?.trim() || "liechtenstein";
  const pack = PACKAGES[key];
  if (!pack) {
    console.error(`Pacchetti: ${Object.keys(PACKAGES).join(", ")}`);
    process.exit(1);
  }
  const dir = path.join(process.cwd(), "data", "osm");
  fs.mkdirSync(dir, { recursive: true });
  for (const item of pack) {
    const dest = path.join(dir, item.filename);
    if (fs.existsSync(dest)) {
      console.log(`[geofabrik] Esiste già ${dest}, skip`);
      continue;
    }
    await download(item.url, dest);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
