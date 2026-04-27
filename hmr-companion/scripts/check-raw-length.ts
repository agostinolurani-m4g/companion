/** Compara lunghezza: GPX grezzo vs GPX semplificato (DP). Solo lettura. */
import fs from "node:fs";
import path from "node:path";
import { parseGpxTrackpoints } from "../src/lib/gpx";
import { simplifyLineString } from "../src/lib/line-simplify";
import { cumulativeKmAlong } from "../src/lib/track-geometry";
import type { Position } from "geojson";

const gpxName = process.env.HMR_GPX_FILENAME || "Hellenic_Mountain_Race_2026.gpx";
const gpxPath = path.join(process.cwd(), "data", gpxName);
if (!fs.existsSync(gpxPath)) {
  console.error("GPX not found:", gpxPath);
  process.exit(1);
}
const xml = fs.readFileSync(gpxPath, "utf8");
const pts = parseGpxTrackpoints(xml);
const raw: Position[] = pts.map((p) => [p.lng, p.lat]);
const rawCum = cumulativeKmAlong(raw);
const rawKm = rawCum[rawCum.length - 1];
console.log(`[raw] trkpt grezzi: ${pts.length} · km totali (haversine): ${rawKm.toFixed(3)}`);

for (const eps of [0.00002, 0.00005, 0.0001]) {
  const simp = simplifyLineString(raw, eps);
  const sc = cumulativeKmAlong(simp);
  const kmSimp = sc[sc.length - 1];
  console.log(
    `[DP eps=${eps.toString().padStart(7)}] ${simp.length.toString().padStart(5)} vertici · km: ${kmSimp.toFixed(3)} · ` +
      `perdita rispetto a raw: ${(rawKm - kmSimp).toFixed(3)} km (${(((rawKm - kmSimp) / rawKm) * 100).toFixed(2)}%)`
  );
}
