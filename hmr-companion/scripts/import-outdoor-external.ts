/**
 * Collega fonti esterne (refuges.info) alle feature outdoor in una bbox alpina.
 *
 * Uso:
 *   npm run outdoor:external
 *   OUTDOOR_BBOX=west,south,east,north npm run outdoor:external
 *   HMR_DB_PATH=/tmp/prova.db npm run outdoor:external
 *
 * Va lanciato DOPO outdoor:import (il collegamento usa le feature OSM già presenti).
 * Idempotente: rilanciarlo aggiorna i link e i punti refuges.info.
 */
import { getDb, getDbPath } from "../src/lib/db";
import { importRefugesInfoBbox } from "../src/lib/outdoor/enrich";
import { parseBboxEnv, splitBbox, DEFAULT_OUTDOOR_BBOX } from "./lib/outdoor-bbox";

async function main() {
  const bbox = parseBboxEnv(process.env.OUTDOOR_BBOX ?? process.argv[2], DEFAULT_OUTDOOR_BBOX);
  const db = getDb();
  console.log(`[external] DB ${getDbPath()} — bbox ${bbox.west},${bbox.south},${bbox.east},${bbox.north}`);
  const totals = { fetched: 0, linkedByRef: 0, linkedByDistance: 0, created: 0, skipped: 0 };
  for (const c of splitBbox(bbox, 2, 2)) {
    const s = await importRefugesInfoBbox(db, c.south, c.west, c.north, c.east);
    console.log(
      `[external] refuges.info ${c.west.toFixed(2)},${c.south.toFixed(2)},${c.east.toFixed(2)},${c.north.toFixed(2)}: ` +
        `${s.fetched} punti, ${s.linkedByRef} per ref, ${s.linkedByDistance} per distanza, ` +
        `${s.created} creati, ${s.skipped} saltati`,
    );
    for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += s[k];
    await new Promise((r) => setTimeout(r, 1000));
  }
  const links = db.prepare(`SELECT COUNT(*) AS n FROM feature_links WHERE source = 'refuges.info'`).get() as {
    n: number;
  };
  console.log(`[external] totale: ${JSON.stringify(totals)} — feature_links refuges.info: ${links.n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
