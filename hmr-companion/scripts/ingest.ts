/**
 * Ingest one-shot: parse GPX → semplifica → calcola cumulato km + elev →
 * salva in `tracks` + seed checkpoints / official_resupply / notable_sections.
 *
 * Usage:
 *   npm run ingest
 *   HMR_GPX_FILENAME=Other.gpx npm run ingest
 */

import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { getDb, getDbPath } from "../src/lib/db";
import {
  HMR_OFFICIAL_TRACK_ID,
  ingestGpxToDb,
} from "../src/lib/track-ingest";
import {
  STATIC_BRIDGES,
  STATIC_CHECKPOINTS,
  STATIC_RESUPPLY,
  STATIC_SECTIONS,
} from "../src/lib/seed-static";

const TRACK_NAME = "Hellenic Mountain Race 2026";

function main() {
  const fileName = process.env.HMR_GPX_FILENAME?.trim() || "Hellenic_Mountain_Race_2026.gpx";
  const gpxPath = path.join(process.cwd(), "data", fileName);
  if (!fs.existsSync(gpxPath)) {
    console.error(`[ingest] GPX non trovato: ${gpxPath}`);
    process.exit(1);
  }

  console.log(`[ingest] Lettura GPX: ${gpxPath}`);
  const xml = fs.readFileSync(gpxPath, "utf8");

  const dbPath = getDbPath();
  console.log(`[ingest] DB path: ${dbPath}`);

  const db = getDb();
  const poiCountBefore = (
    db.prepare(`SELECT COUNT(*) AS n FROM pois WHERE track_id = ?`).get(HMR_OFFICIAL_TRACK_ID) as {
      n: number;
    }
  ).n;

  const result = ingestGpxToDb({
    xml,
    trackId: HMR_OFFICIAL_TRACK_ID,
    name: TRACK_NAME,
    gpxRelPath: `data/${fileName}`,
    seedHmrCourseMarkers: true,
    persistGpxFile: false,
  });

  console.log(`[ingest] Trkpt grezzi: ${result.rawPointCount}`);
  console.log(`[ingest] Dopo DP: ${result.point_count} vertici`);
  console.log(
    `[ingest] Totale: ${result.length_km.toFixed(1)} km · D+ ${result.elev_gain_m} m · D- ${result.elev_loss_m} m`
  );

  const poiCountAfter = (
    db.prepare(`SELECT COUNT(*) AS n FROM pois WHERE track_id = ?`).get(HMR_OFFICIAL_TRACK_ID) as {
      n: number;
    }
  ).n;

  console.log(`[ingest] OK · track id=${HMR_OFFICIAL_TRACK_ID}`);
  console.log(
    `[ingest] ${STATIC_CHECKPOINTS.length} checkpoints / ${STATIC_RESUPPLY.length} resupply / ${STATIC_SECTIONS.length} sections / ${STATIC_BRIDGES.length} bridges`
  );
  console.log(
    `[ingest] POI in DB: ${poiCountAfter} (prima ${poiCountBefore}) — ingest non cancella POI/piani custom.`
  );
  if (poiCountAfter === 0) {
    console.log(`[ingest] Nessun POI: esegui \`npm run snapshot\` per scaricare Overpass (~10–20 min).`);
  }
  console.log(`[ingest] Opzionale: \`npm run snapshot:surface\` per asfalto/sterrato/single (OSM).`);
  console.log(`[ingest] (uuid helper preload: ${uuidv4().slice(0, 4)}…) — dependency ok`);
}

main();
