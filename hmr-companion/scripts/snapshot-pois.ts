/**
 * Snapshot Overpass → POI precomputati sul track HMR.
 *
 * Strategia (ottimizzata per server Overpass congestionati):
 *  - Calcola la bbox della traccia + padding di sicurezza.
 *  - Splitta la bbox in una griglia NxM (default 2x3) e fa UNA query per
 *    cella per categoria (invece di decine di query `around:`).
 *  - Su errori transient (504, "server busy") halving adattivo della cella.
 *  - Risultati cachati per (categoria, cella) in .ingest-cache/<cat>/<cell>.json
 *    così i rerun riprendono da dove era rimasto.
 *  - In locale: per ogni POI proietta sulla traccia → along_km, detour_m,
 *    elev_delta_m; filtra per raggio categoria (water 800 m, hotel 2500 m…).
 *
 *  Modali:
 *  - default: per ogni categoria Overpass si cancella solo quella famiglia in DB, poi insert
 *    (non si azzerano le altre categorie; se interrompi, resta il resto).
 *  - HMR_SNAPSHOT_ONLY=food o food,shop — aggiorna solo quelle categorie (cancellando i POI
 *    di quelle famiglie e rifetch). Utile con cache .ingest-cache per una sola sottocartella.
 *  - HMR_SNAPSHOT_APPEND=1 — nessun DELETE; solo INSERT OR IGNORE (aggiunge nuovi id OSM, non aggiorna né rimuove).
 */

import fs from "node:fs";
import path from "node:path";
import { v5 as uuidv5 } from "uuid";
import type { Position } from "geojson";
import { getDb, getFirstTrack, type PoiCategory } from "../src/lib/db";
import { OSM_POI_UUID_NAMESPACE } from "../src/lib/poi-osm-insert";
import {
  cumulativeKmAlong,
  nearestPointOnPolyline,
} from "../src/lib/track-geometry";
import {
  OverpassError,
  classifyOsm,
  fetchCategoryInBbox,
  osmDescriptionFromTags,
  osmImageFromTags,
  osmOpeningHoursFromTags,
  osmPhoneFromTags,
  osmWebsiteFromTags,
  type Bbox,
  type BboxCategoryKey,
  type OsmNode,
} from "../src/lib/overpass";

type CategoryPlan = {
  key: BboxCategoryKey;
  /** raggio max di detour dalla traccia per considerarlo utile */
  maxDetourM: number;
};

const PLAN: CategoryPlan[] = [
  { key: "water", maxDetourM: 800 },
  { key: "hut", maxDetourM: 1500 },
  { key: "lodging", maxDetourM: 3000 },
  { key: "campsite", maxDetourM: 3000 },
  { key: "shop", maxDetourM: 2000 },
  { key: "food", maxDetourM: 2000 },
  { key: "health", maxDetourM: 3000 },
  { key: "utilities", maxDetourM: 2500 },
];

/** Chiavi Overpass (PLAN) → colonne `pois.category` in SQLite. */
const PLAN_KEY_TO_DB_CATEGORIES: Record<BboxCategoryKey, PoiCategory[]> = {
  water: ["water"],
  hut: ["hut"],
  lodging: ["lodging"],
  campsite: ["campsite"],
  shop: ["shop"],
  food: ["restaurant"],
  health: ["pharmacy"],
  utilities: ["atm", "bus"],
};

const ALL_PLAN_KEYS = PLAN.map((p) => p.key);

function parseSnapshotOnlyList(): BboxCategoryKey[] | null {
  const raw = process.env.HMR_SNAPSHOT_ONLY?.trim();
  if (!raw) return null;
  const tokens = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const out: BboxCategoryKey[] = [];
  for (const t of tokens) {
    if (ALL_PLAN_KEYS.includes(t as BboxCategoryKey)) {
      if (!out.includes(t as BboxCategoryKey)) out.push(t as BboxCategoryKey);
    } else {
      console.warn(`[snapshot] HMR_SNAPSHOT_ONLY: ignorata chiave sconosciuta «${t}»`);
    }
  }
  if (out.length === 0) {
    console.error(
      `[snapshot] HMR_SNAPSHOT_ONLY non ha chiavi valide. Valide: ${ALL_PLAN_KEYS.join(", ")}`
    );
    process.exit(1);
  }
  return out;
}

const POI_NAMESPACE = OSM_POI_UUID_NAMESPACE;
const CACHE_DIR = path.join(process.cwd(), ".ingest-cache");
const MAX_ATTEMPTS = parseInt(process.env.HMR_SNAPSHOT_RETRIES ?? "2", 10) || 2;
const BETWEEN_CALLS_MS = parseInt(process.env.HMR_SNAPSHOT_PAUSE_MS ?? "600", 10) || 600;
const GRID_COLS = parseInt(process.env.HMR_SNAPSHOT_GRID_COLS ?? "4", 10) || 4;
const GRID_ROWS = parseInt(process.env.HMR_SNAPSHOT_GRID_ROWS ?? "5", 10) || 5;
const BBOX_PAD_DEG = parseFloat(process.env.HMR_SNAPSHOT_BBOX_PAD ?? "0.03") || 0.03;
const SPLIT_MAX_DEPTH = parseInt(process.env.HMR_SNAPSHOT_SPLIT_DEPTH ?? "4", 10) || 4;
const CONCURRENCY = Math.max(
  1,
  Math.min(4, parseInt(process.env.HMR_SNAPSHOT_CONCURRENCY ?? "1", 10) || 1)
);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cellId(b: Bbox): string {
  const fmt = (n: number) => n.toFixed(4).replace(/\./g, "_");
  return `${fmt(b[0])}_${fmt(b[1])}__${fmt(b[2])}_${fmt(b[3])}`;
}

function chunkCachePath(key: string, cell: Bbox): string {
  const dir = path.join(CACHE_DIR, key);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${cellId(cell)}.json`);
}

function loadCachedCell(file: string): OsmNode[] | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as OsmNode[];
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function splitBbox(b: Bbox, cols: number, rows: number): Bbox[] {
  const [s, w, n, e] = b;
  const dLat = (n - s) / rows;
  const dLng = (e - w) / cols;
  const out: Bbox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push([s + r * dLat, w + c * dLng, s + (r + 1) * dLat, w + (c + 1) * dLng]);
    }
  }
  return out;
}

async function fetchCellWithRetry(
  key: BboxCategoryKey,
  cell: Bbox,
  depth = 0
): Promise<OsmNode[]> {
  const cacheFile = chunkCachePath(key, cell);
  const cached = loadCachedCell(cacheFile);
  if (cached) return cached;
  let attempt = 0;
  while (true) {
    try {
      const nodes = await fetchCategoryInBbox(key, cell);
      fs.writeFileSync(cacheFile, JSON.stringify(nodes));
      await sleep(BETWEEN_CALLS_MS);
      return nodes;
    } catch (e) {
      attempt += 1;
      const err = e as Error;
      const isTransient =
        e instanceof OverpassError ? e.transient : /timeout|fetch/i.test(err.message);
      if (!isTransient) throw err;
      if (attempt > MAX_ATTEMPTS) {
        if (depth < SPLIT_MAX_DEPTH) {
          const [s, w, n, e2] = cell;
          const latMid = (s + n) / 2;
          const lngMid = (w + e2) / 2;
          console.warn(
            `      ↘︎ split cella ${cellId(cell)} (d${depth}) dopo ${attempt - 1} retry: ${err.message}`
          );
          const sub: Bbox[] = [
            [s, w, latMid, lngMid],
            [s, lngMid, latMid, e2],
            [latMid, w, n, lngMid],
            [latMid, lngMid, n, e2],
          ];
          const acc: OsmNode[] = [];
          for (const c of sub) {
            const r = await fetchCellWithRetry(key, c, depth + 1);
            acc.push(...r);
          }
          fs.writeFileSync(cacheFile, JSON.stringify(acc));
          return acc;
        }
        console.warn(
          `      ✖ cella ${cellId(cell)} (d${depth}) abbandonata dopo ${attempt - 1} retry + split: ${err.message}`
        );
        // NON cachiamo fallimenti: al prossimo run riproveremo.
        return [];
      }
      const retryAfter =
        e instanceof OverpassError && typeof e.retryAfterSec === "number"
          ? e.retryAfterSec * 1000
          : 0;
      const base = retryAfter > 0 ? retryAfter : Math.min(20_000, 1500 * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 1500);
      const wait = base + jitter;
      console.warn(
        `      ⏳ retry ${attempt}/${MAX_ATTEMPTS} in ${Math.round(wait / 1000)}s cella ${cellId(cell)} (d${depth}) — ${err.message}`
      );
      await sleep(wait);
    }
  }
}

async function collectCategory(
  key: BboxCategoryKey,
  cells: Bbox[]
): Promise<OsmNode[]> {
  const acc: OsmNode[] = [];
  const seen = new Set<string>();
  let index = 0;
  let done = 0;
  const total = cells.length;
  const addNodes = (nodes: OsmNode[]) => {
    for (const n of nodes) {
      if (n.lat == null || n.lon == null) continue;
      const k = `${n.type}:${n.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      acc.push(n);
    }
  };
  const worker = async (workerId: number) => {
    while (true) {
      const i = index++;
      if (i >= cells.length) return;
      const cell = cells[i];
      const nodes = await fetchCellWithRetry(key, cell);
      addNodes(nodes);
      done += 1;
      console.log(
        `  · cella ${done.toString().padStart(2)}/${total} [w${workerId}] ${cellId(cell)} ↳ ${nodes.length} (unici ${acc.length})`
      );
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));
  const summary = path.join(CACHE_DIR, `${key}.json`);
  fs.writeFileSync(summary, JSON.stringify(acc));
  return acc;
}

function trackBbox(coords: Position[], pad: number): Bbox {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const c of coords) {
    const lng = c[0];
    const lat = c[1];
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLat - pad, minLng - pad, maxLat + pad, maxLng + pad];
}

async function main() {
  const track = getFirstTrack();
  if (!track) {
    console.error(`[snapshot] Nessuna traccia in DB. Esegui prima \`npm run ingest\`.`);
    process.exit(1);
  }
  const coords = (JSON.parse(track.coords_json) as [number, number, number | null, number][]).map(
    (c) => {
      const p: Position = [c[0], c[1]];
      if (c[2] != null) p.push(c[2]);
      return p;
    }
  );
  console.log(
    `[snapshot] Track: ${track.name} · ${coords.length} vertici · ${track.length_km.toFixed(1)} km`
  );

  const cum = cumulativeKmAlong(coords);
  const bbox = trackBbox(coords, BBOX_PAD_DEG);
  const cells = splitBbox(bbox, GRID_COLS, GRID_ROWS);
  console.log(
    `[snapshot] bbox [${bbox.map((n) => n.toFixed(3)).join(", ")}] → grid ${GRID_COLS}x${GRID_ROWS} = ${cells.length} celle`
  );
  console.log(
    `[snapshot] pausa ${BETWEEN_CALLS_MS}ms, retry ${MAX_ATTEMPTS}, concurrency ${CONCURRENCY}, split adattivo attivo`
  );

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  const appendOnly = process.env.HMR_SNAPSHOT_APPEND === "1" || process.env.HMR_SNAPSHOT_APPEND === "true";
  const onlyKeys = parseSnapshotOnlyList();
  const plans = onlyKeys
    ? PLAN.filter((p) => onlyKeys.includes(p.key))
    : PLAN;
  if (onlyKeys) {
    console.log(`[snapshot] solo categorie: ${onlyKeys.join(", ")} (le altre restano in DB)`);
  }
  if (appendOnly) {
    console.log(
      "[snapshot] HMR_SNAPSHOT_APPEND: nessun DELETE; solo inserimenti nuovi (INSERT OR IGNORE)"
    );
  }

  const db = getDb();

  const insert = db.prepare(
    `INSERT OR IGNORE INTO pois
      (id, track_id, category, sub_kind, name, lat, lng, along_km, detour_m, elev_delta_m,
       phone, website, opening_hours, description, image_url, osm_type, osm_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const elevForIdx = (i: number): number | null => {
    const p = coords[i];
    return typeof p[2] === "number" ? p[2] : null;
  };

  for (const plan of plans) {
    if (!appendOnly) {
      const cats = PLAN_KEY_TO_DB_CATEGORIES[plan.key];
      const ph = cats.map(() => "?").join(", ");
      const del = db.prepare(
        `DELETE FROM pois WHERE track_id = ? AND category IN (${ph})`
      );
      const n = del.run(track.id, ...cats).changes;
      if (n > 0) {
        console.log(`[snapshot]   rimossi ${n} POI [${cats.join(", ")}] (prima del refill)`);
      }
    }
    console.log(`\n[snapshot] ▶ ${plan.key} (detour max ${plan.maxDetourM} m)`);
    let nodes: OsmNode[];
    try {
      nodes = await collectCategory(plan.key, cells);
    } catch (e) {
      console.error(
        `  ✖ categoria ${plan.key} abbandonata: ${(e as Error).message}. Riprova più tardi.`
      );
      continue;
    }
    console.log(`  · totali: ${nodes.length} nodi unici nella bbox`);

    let inserted = 0;
    let skippedFar = 0;
    const txn = db.transaction((list: OsmNode[]) => {
      for (const n of list) {
        if (n.lat == null || n.lon == null) continue;
        const tags = n.tags ?? {};
        const klass = classifyOsm(tags);
        if (!klass) continue;
        const projected = nearestPointOnPolyline(coords, [n.lon, n.lat], cum);
        if (!projected) continue;
        const detourM = Math.round(projected.distKm * 1000);
        if (detourM > plan.maxDetourM) {
          skippedFar += 1;
          continue;
        }
        const elevTrack = elevForIdx(projected.segIndex) ?? elevForIdx(projected.segIndex + 1);
        const elevPoi = tags.ele ? parseFloat(tags.ele) : null;
        const elevDelta =
          elevTrack != null && elevPoi != null && Number.isFinite(elevPoi)
            ? Math.round(elevPoi - elevTrack)
            : null;
        const osmUid = `${n.type}:${n.id}`;
        const id = uuidv5(osmUid, POI_NAMESPACE);
        const res = insert.run(
          id,
          track.id,
          klass.category,
          klass.sub_kind,
          tags.name ?? tags["name:en"] ?? tags["name:el"] ?? null,
          n.lat,
          n.lon,
          Number(projected.alongKm.toFixed(3)),
          detourM,
          elevDelta,
          osmPhoneFromTags(tags),
          osmWebsiteFromTags(tags),
          osmOpeningHoursFromTags(tags),
          osmDescriptionFromTags(tags),
          osmImageFromTags(tags),
          n.type,
          n.id,
          Date.now()
        );
        if (res.changes > 0) inserted += 1;
      }
    });
    txn(nodes);
    console.log(
      `  · inseriti ${inserted} POI · scartati ${skippedFar} oltre il detour massimo`
    );
  }

  console.log(`\n[snapshot] Riepilogo:`);
  const byCat = db
    .prepare(
      `SELECT category, COUNT(*) AS n FROM pois WHERE track_id = ? GROUP BY category ORDER BY category`
    )
    .all(track.id) as { category: PoiCategory; n: number }[];
  for (const r of byCat) console.log(`  · ${r.category.padEnd(12)} ${r.n}`);
  const total = byCat.reduce((acc, r) => acc + r.n, 0);
  console.log(`  · totale: ${total} POI`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
