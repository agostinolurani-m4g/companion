/**
 * Backfill per gli itinerari OSM già importati: ricava dalle way membro sac_scale massimo e
 * prevalente, fondo prevalente e tratti attrezzati; calcola il punteggio di qualità.
 * Aggiorna solo `meta_json` (chiavi `way_facts`, `quality`).
 *
 *   npm run enrich:osm-routes                     # 200 relazioni senza way_facts
 *   ENRICH_LIMIT=all npm run enrich:osm-routes    # tutte
 *   OSM_ENRICH_BATCH=40 OSM_ENRICH_PAUSE_MS=1500  # lotto e pausa tra query Overpass
 *
 * Idempotente e riprendibile. Dati © OpenStreetMap contributors (ODbL).
 */
import { getDb, getDbPath } from "../src/lib/db";
import { aggregateWayFacts, overpassGeomLengthM, routeQuality, type WayInfo } from "../src/lib/osm-way-facts";
import { fetchOverpassRawElements } from "../src/lib/overpass";
import { envLimit, sleep } from "./lib/c2c-import";

const LIMIT = envLimit("ENRICH_LIMIT", 200);
const BATCH = envLimit("OSM_ENRICH_BATCH", 40);
const PAUSE_MS = envLimit("OSM_ENRICH_PAUSE_MS", 1500);

type Row = { id: string; name: string; length_km: number; external_id: string; meta_json: string | null };
type El =
  | { type: "relation"; id: number; tags?: Record<string, string>; members?: { type: string; ref: number; role?: string }[] }
  | { type: "way"; id: number; tags?: Record<string, string>; geometry?: ({ lat: number; lon: number } | null)[] };

function parse(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function main() {
  const db = getDb();
  console.log(`DB: ${getDbPath()} · limite ${LIMIT === Infinity ? "nessuno" : LIMIT} · lotto ${BATCH}`);
  const all = db
    .prepare(
      `SELECT id, name, length_km, external_id, meta_json FROM user_routes
       WHERE source = 'osm' AND external_id LIKE 'relation/%'
         AND json_extract(meta_json, '$.way_facts') IS NULL
       ORDER BY created_at ASC`,
    )
    .all() as Row[];
  const todo = all.slice(0, LIMIT === Infinity ? all.length : LIMIT);
  console.log(`Da arricchire: ${todo.length} di ${all.length}`);
  const upd = db.prepare(`UPDATE user_routes SET meta_json = ? WHERE id = ?`);
  let ok = 0;
  let missing = 0;
  let failedBatches = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const ids = batch.map((r) => Number(r.external_id.slice("relation/".length))).filter(Number.isFinite);
    const q = `[out:json][timeout:180];
rel(id:${ids.join(",")})->.r;
.r out body;
way(r.r);
out geom;`;
    let els: El[];
    try {
      els = (await fetchOverpassRawElements(q)) as El[];
    } catch (e) {
      failedBatches++;
      console.warn(`lotto ${i / BATCH + 1} fallito:`, e instanceof Error ? e.message : e);
      await sleep(PAUSE_MS * 2);
      continue;
    }
    const rels = new Map<number, Extract<El, { type: "relation" }>>();
    const ways = new Map<number, Extract<El, { type: "way" }>>();
    for (const el of els) {
      if (el.type === "relation") rels.set(el.id, el);
      else if (el.type === "way") ways.set(el.id, el);
    }
    const tx = db.transaction(() => {
      for (const r of batch) {
        const relId = Number(r.external_id.slice("relation/".length));
        const meta = parse(r.meta_json);
        const rel = rels.get(relId);
        if (!rel) {
          // Relazione cancellata o non più route: segna per non ritentare.
          meta.way_facts = { ways: 0, missing: true };
          upd.run(JSON.stringify(meta), r.id);
          missing++;
          continue;
        }
        const infos: WayInfo[] = (rel.members ?? [])
          .filter((m) => m.type === "way" && !/^(platform|stop)/.test(m.role ?? ""))
          .map((m) => {
            const w = ways.get(m.ref);
            return { lengthM: overpassGeomLengthM(w?.geometry), tags: w?.tags ?? {} };
          });
        meta.way_facts = aggregateWayFacts(infos);
        meta.quality = routeQuality({
          length_km: r.length_km,
          coverage: typeof meta.coverage === "number" ? meta.coverage : null,
          chains: typeof meta.stitched_chains === "number" ? meta.stitched_chains : null,
          hasName: !!rel.tags?.name,
          hasRef: !!rel.tags?.ref,
        });
        upd.run(JSON.stringify(meta), r.id);
        ok++;
      }
    });
    tx();
    console.log(`  lotto ${i / BATCH + 1}/${Math.ceil(todo.length / BATCH)}: ok ${ok}, mancanti ${missing}`);
    if (i + BATCH < todo.length) await sleep(PAUSE_MS);
  }
  console.log(`Fatto: arricchiti=${ok} mancanti=${missing} lotti falliti=${failedBatches}`);
}

void main();
