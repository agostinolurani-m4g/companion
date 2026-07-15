/**
 * Scarica e unisce le micro-regioni EAWS italiane in src/lib/data/eaws-regions-it.json
 * Esegui: npm run bundle:eaws
 */
import fs from "node:fs";
import path from "node:path";

const IT_FILES = [
  "IT-21_micro-regions_elevation.geojson.json",
  "IT-23_micro-regions_elevation.geojson.json",
  "IT-25_micro-regions_elevation.geojson.json",
  "IT-25-SO-LI_micro-regions_elevation.geojson.json",
  "IT-32-BZ_micro-regions_elevation.geojson.json",
  "IT-32-TN_micro-regions_elevation.geojson.json",
  "IT-34_micro-regions_elevation.geojson.json",
  "IT-36_micro-regions_elevation.geojson.json",
  "IT-57_micro-regions_elevation.geojson.json",
  "IT-MeteoMont_micro-regions_elevation.geojson.json",
];

const BASE =
  "https://gitlab.com/eaws/eaws-regions/-/raw/master/public/micro-regions_elevation";

async function main() {
  const features: GeoJSON.Feature[] = [];
  for (const file of IT_FILES) {
    const url = `${BASE}/${file}`;
    process.stdout.write(`Fetching ${file}… `);
    const res = await fetch(url, { headers: { "User-Agent": "hmr-companion/0.1" } });
    if (!res.ok) {
      console.log(`SKIP (${res.status})`);
      continue;
    }
    const fc = (await res.json()) as GeoJSON.FeatureCollection;
    const n = fc.features?.length ?? 0;
    features.push(...(fc.features ?? []));
    console.log(`${n} features`);
    await new Promise((r) => setTimeout(r, 300));
  }

  const out: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
  const outPath = path.join(process.cwd(), "src/lib/data/eaws-regions-it.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`Wrote ${features.length} features → ${outPath}`);
}

void main();
