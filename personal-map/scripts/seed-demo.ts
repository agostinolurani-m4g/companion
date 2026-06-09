/**
 * Importa un GPX di esempio per dogfood locale (senza snapshot Overpass).
 * Uso: npx tsx scripts/seed-demo.ts [path-to.gpx]
 */
import fs from "node:fs";
import path from "node:path";
import { ingestGpxToDb, resolveUniqueTrackId, trackExists } from "../src/lib/track-ingest";

const defaultGpx = path.join(
  process.cwd(),
  "..",
  "hmr-companion",
  "data",
  "Hellenic_Mountain_Race_2026.gpx"
);

const gpxPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultGpx;
const ownerId = process.env.SEED_OWNER ?? "ago";

if (!fs.existsSync(gpxPath)) {
  console.error("GPX non trovato:", gpxPath);
  process.exit(1);
}

const xml = fs.readFileSync(gpxPath, "utf8");
const baseName = path.basename(gpxPath, path.extname(gpxPath));
const trackId = resolveUniqueTrackId(baseName, trackExists);
const gpxRelPath = path.posix.join("data", "uploads", `${trackId}.gpx`);

const result = ingestGpxToDb({
  xml,
  trackId,
  name: baseName.replace(/[_-]+/g, " "),
  ownerId,
  gpxRelPath,
  activityType: "gravel",
  persistGpxFile: true,
});

console.log(JSON.stringify({ ok: true, ownerId, ...result }, null, 2));
