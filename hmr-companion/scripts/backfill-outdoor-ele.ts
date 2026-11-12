/**
 * Backfill della quota dal DEM (Terrarium AWS) per i punti outdoor senza `ele`.
 *
 * Uso:
 *   npm run outdoor:ele
 *   OUTDOOR_ELE_LIMIT=20000 OUTDOOR_ELE_ZOOM=13 npm run outdoor:ele
 *
 * Env:
 *   OUTDOOR_ELE_LIMIT   punti massimi per esecuzione (default 5000; 0 = tutti)
 *   OUTDOOR_ELE_BATCH   punti per transazione (default 500)
 *   OUTDOOR_ELE_ZOOM    zoom tile DEM (default 13 ≈ 13 m/pixel alle nostre latitudini)
 *   OUTDOOR_BBOX        west,south,east,north (default: tutto)
 *   OUTDOOR_ELE_GROUPS  gruppi da trattare (default: tutti i punti; le linee sono sempre escluse)
 *   HMR_DB_PATH         DB di destinazione
 *
 * Idempotente: aggiorna solo righe con ele NULL e marca ele_source='dem'; il re-import OSM
 * conserva la quota DEM se il tag ele resta assente. Le righe non risolte restano NULL e
 * vengono ritentate al giro successivo.
 */
import { getDb, getDbPath } from "../src/lib/db";
import { setDemElevation } from "../src/lib/outdoor/store";
import { lngLatToTile } from "../src/lib/outdoor/tiles";
import { elevationsNode } from "./lib/dem-node";
import { parseBboxEnv } from "./lib/outdoor-bbox";
import { parseKindList } from "../src/lib/outdoor/pbf-filter";

const limitRaw = Number(process.env.OUTDOOR_ELE_LIMIT ?? "5000");
const LIMIT = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : Number.MAX_SAFE_INTEGER;
const BATCH = Math.max(1, Number(process.env.OUTDOOR_ELE_BATCH ?? "500") || 500);
const ZOOM = Math.min(15, Math.max(10, Number(process.env.OUTDOOR_ELE_ZOOM ?? "13") || 13));

type Row = { id: string; lat: number; lng: number };

async function main() {
  const db = getDb();
  const world = { west: -180, south: -85, east: 180, north: 85 };
  const bbox = parseBboxEnv(process.env.OUTDOOR_BBOX, world);
  const groups = [...parseKindList(process.env.OUTDOOR_ELE_GROUPS)];
  const groupClause = groups.length > 0 ? ` AND grp IN (${groups.map(() => "?").join(",")})` : "";

  const pending = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM outdoor_features
         WHERE ele IS NULL AND geom_json IS NULL
           AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?${groupClause}`,
      )
      .get(bbox.south, bbox.north, bbox.west, bbox.east, ...groups) as { n: number }
  ).n;
  console.log(
    `[outdoor:ele] DB ${getDbPath()} — punti senza quota: ${pending.toLocaleString()}, ` +
      `limite ${LIMIT === Number.MAX_SAFE_INTEGER ? "nessuno" : LIMIT}, zoom DEM ${ZOOM}`,
  );

  const select = db.prepare(
    `SELECT id, lat, lng FROM outdoor_features
     WHERE ele IS NULL AND geom_json IS NULL AND rowid > ?
       AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?${groupClause}
     ORDER BY rowid LIMIT ?`,
  );
  const rowidOf = db.prepare(`SELECT rowid AS r FROM outdoor_features WHERE id = ?`);

  const t0 = Date.now();
  let lastRowid = 0;
  let done = 0;
  let updated = 0;
  let failed = 0;
  while (done < LIMIT) {
    const take = Math.min(BATCH * 4, LIMIT - done);
    const rows = select.all(lastRowid, bbox.south, bbox.north, bbox.west, bbox.east, ...groups, take) as Row[];
    if (rows.length === 0) break;
    lastRowid = (rowidOf.get(rows[rows.length - 1]!.id) as { r: number }).r;
    // Ordina per tile DEM così la cache di dem-node viene riusata.
    rows.sort((a, b) => {
      const ta = lngLatToTile(a.lng, a.lat, ZOOM);
      const tb = lngLatToTile(b.lng, b.lat, ZOOM);
      return ta.x - tb.x || ta.y - tb.y;
    });
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const results: Array<{ id: string; ele: number }> = [];
      for (const r of chunk) {
        const e = await elevationsNode([[r.lng, r.lat]], ZOOM);
        const v = e?.[0];
        // Terrarium: mare/nodata < -100 m; quote > 5000 m non esistono nell'area.
        if (v == null || !Number.isFinite(v) || v < -100 || v > 5000) {
          failed++;
          continue;
        }
        results.push({ id: r.id, ele: Math.round(v) });
      }
      db.transaction(() => {
        for (const r of results) if (setDemElevation(db, r.id, r.ele)) updated++;
      })();
      done += chunk.length;
    }
    console.log(
      `[outdoor:ele] ${done.toLocaleString()} elaborati, ${updated.toLocaleString()} aggiornati, ` +
        `${failed} non risolti (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
    );
  }
  console.log(
    `[outdoor:ele] fine: ${updated.toLocaleString()} quote DEM scritte, ${failed} non risolte, ` +
      `restano ${Math.max(0, pending - updated).toLocaleString()} punti senza quota`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
