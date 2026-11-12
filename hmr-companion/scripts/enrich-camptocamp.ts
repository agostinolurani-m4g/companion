/**
 * Arricchisce i percorsi camptocamp già importati rileggendo il dettaglio di ciascuno:
 * descrizione completa e riassunto con lingua (it → en → fr), durata (in giorni) anche per lo
 * sci, punto di accesso, zone. Aggiorna solo `meta_json` (non geometria né `updated_at`).
 *
 *   npm run enrich:c2c                         # 50 percorsi non ancora arricchiti
 *   ENRICH_LIMIT=all npm run enrich:c2c        # tutti
 *   C2C_ENRICH_ACTS=skitouring,hiking ENRICH_LIMIT=20 npm run enrich:c2c
 *   ENRICH_FORCE=1 …                           # rielabora anche quelli già arricchiti
 *
 * Idempotente e riprendibile: salta i record con `meta_json.enriched_at`.
 * Licenza contenuti: CC-BY-SA 4.0 (camptocamp.org).
 */
import { C2C_ACTIVITY_MAP, getRoute, type C2cActivity } from "../src/lib/camptocamp";
import { buildC2cMeta, mergeC2cMeta } from "../src/lib/camptocamp-meta";
import { getDb, getDbPath, type UserRouteActivity } from "../src/lib/db";
import { envLimit, sleep } from "./lib/c2c-import";

const LIMIT = envLimit("ENRICH_LIMIT", 50);
const PAUSE_MS = 400;
const FORCE = process.env.ENRICH_FORCE === "1";
const ACTS = process.env.C2C_ENRICH_ACTS?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;

const APP_TO_C2C: Partial<Record<UserRouteActivity, C2cActivity>> = { ski: "skitouring" };
for (const [c2c, app] of Object.entries(C2C_ACTIVITY_MAP)) APP_TO_C2C[app] = c2c as C2cActivity;

type Row = { id: string; activity: UserRouteActivity; external_id: string | null; meta_json: string | null };

function parse(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main() {
  const db = getDb();
  console.log(`DB: ${getDbPath()} · limite ${LIMIT === Infinity ? "nessuno" : LIMIT}${FORCE ? " · force" : ""}`);
  const rows = db
    .prepare(
      `SELECT id, activity, external_id, meta_json FROM user_routes
       WHERE source = 'camptocamp' AND external_id IS NOT NULL
         ${FORCE ? "" : "AND json_extract(meta_json, '$.enriched_at') IS NULL"}
       ORDER BY created_at ASC`,
    )
    .all() as Row[];
  const todo = rows.filter((r) => {
    const old = parse(r.meta_json);
    const act = (old?.c2c_activity as C2cActivity | undefined) ?? APP_TO_C2C[r.activity];
    return act && (!ACTS || ACTS.includes(act));
  });
  console.log(`Da arricchire: ${todo.length}`);
  const upd = db.prepare(`UPDATE user_routes SET meta_json = ? WHERE id = ?`);
  let ok = 0;
  let failed = 0;
  for (const r of todo) {
    if (ok + failed >= LIMIT) break;
    const old = parse(r.meta_json);
    const act = ((old?.c2c_activity as C2cActivity | undefined) ?? APP_TO_C2C[r.activity])!;
    const id = Number(r.external_id);
    if (!Number.isFinite(id)) continue;
    await sleep(PAUSE_MS);
    try {
      const detail = await getRoute(id);
      upd.run(JSON.stringify(mergeC2cMeta(old, buildC2cMeta(detail, act))), r.id);
      ok++;
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`${id}: ${msg}`);
      // Documento rimosso o protetto: marca per non ritentare a ogni esecuzione.
      if (/HTTP (403|404|410)/.test(msg)) {
        upd.run(JSON.stringify({ ...(old ?? {}), enriched_at: Date.now(), enrich_error: msg }), r.id);
      }
    }
    if ((ok + failed) % 25 === 0) console.log(`  … ${ok + failed} (ok ${ok}, errori ${failed})`);
  }
  console.log(`Fatto: arricchiti=${ok} errori=${failed} rimanenti≈${Math.max(0, todo.length - ok - failed)}`);
}

void main();
