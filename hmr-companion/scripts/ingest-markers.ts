/**
 * Ingest parziale: solo resupply ufficiali + ponti + sezioni tough (pericolo).
 * Usa la traccia già in DB (nessun re-parse GPX). Non tocca `pois` né snapshot OSM.
 *
 * Usage:
 *   npm run ingest:markers
 *   HMR_DB_PATH=/data/hmr.db npm run ingest:markers   # sul VPS, volume Docker
 */

import type { Position } from "geojson";
import { getDb, getDbPath } from "../src/lib/db";
import { reseedCourseMarkers } from "../src/lib/reseed-course-markers";
import type { StoredCoord } from "../src/lib/track-coords";

const TRACK_ID = process.env.HMR_TRACK_ID?.trim() || "hmr-2026";

function main() {
  const db = getDb();
  const dbPath = getDbPath();
  console.log(`[ingest:markers] DB: ${dbPath}`);

  const track = db.prepare(`SELECT id, coords_json, length_km FROM tracks WHERE id = ?`).get(TRACK_ID) as
    | { id: string; coords_json: string; length_km: number }
    | undefined;

  if (!track) {
    console.error(`[ingest:markers] Traccia "${TRACK_ID}" assente. Esegui prima \`npm run ingest\` (una volta).`);
    process.exit(1);
  }

  const stored = JSON.parse(track.coords_json) as StoredCoord[];
  if (stored.length < 2) {
    console.error(`[ingest:markers] coords_json vuoto o invalido`);
    process.exit(1);
  }

  const simplified: Position[] = stored.map((c) => [c[0], c[1]]);
  const cum = stored.map((c) => c[3]);
  const totalKm = track.length_km || cum[cum.length - 1];

  const poiBefore = (db.prepare(`SELECT COUNT(*) AS n FROM pois WHERE track_id = ?`).get(TRACK_ID) as { n: number })
    .n;

  let result = { resupply: 0, bridges: 0, sections: 0 };
  const tx = db.transaction(() => {
    result = reseedCourseMarkers(db, TRACK_ID, simplified, cum, totalKm, (msg) =>
      console.log(`[ingest:markers] ${msg}`)
    );
  });
  tx();

  const poiAfter = (db.prepare(`SELECT COUNT(*) AS n FROM pois WHERE track_id = ?`).get(TRACK_ID) as { n: number }).n;

  console.log(`[ingest:markers] OK · track=${TRACK_ID}`);
  console.log(
    `[ingest:markers] ${result.resupply} resupply · ${result.bridges} bridges · ${result.sections} sections`
  );
  console.log(`[ingest:markers] POI OSM/custom: ${poiAfter} (prima ${poiBefore}) — invariati se uguali.`);
}

main();
