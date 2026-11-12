/**
 * Backfill dei fatti derivati per i percorsi pubblici: forma (anello / andata e ritorno /
 * traversata, non per camptocamp che ha `route_types`) e quota min/max dal DEM (tile
 * Terrarium). Salva `meta_json.derived`.
 *
 *   npm run backfill:route-derived                  # 200 percorsi senza `derived`
 *   BACKFILL_LIMIT=all npm run backfill:route-derived
 *   BACKFILL_SOURCE=osm BACKFILL_LIMIT=20 npm run backfill:route-derived
 *
 * Idempotente e riprendibile. Non modifica geometria, dislivelli né `updated_at`.
 */
import { getDb, getDbPath } from "../src/lib/db";
import { buildDerivedFacts } from "../src/lib/route-shape";
import { parseSkiGeoJson } from "../src/lib/ski-overlays";
import { envLimit } from "./lib/c2c-import";
import { elevationsNode, resampleLine } from "./lib/dem-node";

type Pt = [number, number];
const LIMIT = envLimit("BACKFILL_LIMIT", 200);
const SOURCE = process.env.BACKFILL_SOURCE?.trim() || null;

type Row = { id: string; source: string | null; activity: string; geojson: string; meta_json: string | null };

function routeCoords(activity: string, raw: string): Pt[] {
  let gj: GeoJSON.GeoJSON;
  try {
    gj = JSON.parse(raw) as GeoJSON.GeoJSON;
  } catch {
    return [];
  }
  if (gj.type === "Feature" && gj.geometry?.type === "LineString") return gj.geometry.coordinates as Pt[];
  if (gj.type === "FeatureCollection") {
    if (activity === "ski") {
      const { ascentCoords, descentCoords } = parseSkiGeoJson(gj);
      return [...(ascentCoords ?? []), ...(descentCoords ?? [])];
    }
    return gj.features.flatMap((f) => (f.geometry?.type === "LineString" ? (f.geometry.coordinates as Pt[]) : []));
  }
  return [];
}

async function main() {
  const db = getDb();
  console.log(`DB: ${getDbPath()} · limite ${LIMIT === Infinity ? "nessuno" : LIMIT}${SOURCE ? ` · fonte ${SOURCE}` : ""}`);
  const rows = db
    .prepare(
      `SELECT id, source, activity, geojson, meta_json FROM user_routes
       WHERE visibility = 'public' AND json_extract(coalesce(meta_json, '{}'), '$.derived') IS NULL
         ${SOURCE ? "AND source = @source" : ""}
       ORDER BY created_at ASC
       ${LIMIT === Infinity ? "" : "LIMIT @limit"}`,
    )
    .all({ source: SOURCE, limit: LIMIT === Infinity ? -1 : LIMIT }) as Row[];
  console.log(`Da elaborare: ${rows.length}`);
  const upd = db.prepare(`UPDATE user_routes SET meta_json = ? WHERE id = ?`);
  let ok = 0;
  let noDem = 0;
  let skipped = 0;
  for (const r of rows) {
    const coords = routeCoords(r.activity, r.geojson);
    let meta: Record<string, unknown> = {};
    try {
      meta = r.meta_json ? (JSON.parse(r.meta_json) as Record<string, unknown>) : {};
    } catch {
      meta = {};
    }
    if (coords.length < 2) {
      meta.derived = { shape: null, ele_min_dem: null, ele_max_dem: null, start: null, computed_at: Date.now() };
      upd.run(JSON.stringify(meta), r.id);
      skipped++;
      continue;
    }
    const elev = await elevationsNode(resampleLine(coords, 80, 800));
    if (!elev) {
      // DEM non raggiungibile: non salvare, così il record viene ripreso alla prossima esecuzione.
      noDem++;
      continue;
    }
    meta.derived = buildDerivedFacts(coords, elev);
    // camptocamp: il tracciato è spesso solo la salita → la forma geometrica non è affidabile
    // (si usa `route_types` della fonte); restano utili le quote dal DEM.
    if (r.source === "camptocamp") (meta.derived as { shape: unknown }).shape = null;
    upd.run(JSON.stringify(meta), r.id);
    ok++;
    if (ok % 25 === 0) console.log(`  … ${ok}`);
  }
  console.log(`Fatto: elaborati=${ok} senza DEM (da ritentare)=${noDem} senza geometria=${skipped}`);
}

void main();
