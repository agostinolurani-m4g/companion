import fs from "node:fs";
import path from "node:path";
import { v5 as uuidv5 } from "uuid";
import type { Position } from "geojson";
import { getDb, getTrack, type PoiCategory, type TrackRow } from "@/lib/db";
import { OSM_POI_UUID_NAMESPACE } from "@/lib/poi-osm-insert";
import { cumulativeKmAlong, nearestPointOnPolyline } from "@/lib/track-geometry";
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
} from "@/lib/overpass";

type CategoryPlan = { key: BboxCategoryKey; maxDetourM: number };

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

const POI_NAMESPACE = OSM_POI_UUID_NAMESPACE;

export type SnapshotPoiRunOptions = {
  gridCols?: number;
  gridRows?: number;
  bboxPadDeg?: number;
  pauseMs?: number;
  maxAttempts?: number;
  concurrency?: number;
  splitMaxDepth?: number;
  onlyKeys?: BboxCategoryKey[] | null;
  appendOnly?: boolean;
  cacheDir?: string;
  log?: (msg: string) => void;
};

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

function envFloat(name: string, fallback: number): number {
  const v = parseFloat(process.env[name] ?? "");
  return Number.isFinite(v) ? v : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cellId(b: Bbox): string {
  const fmt = (n: number) => n.toFixed(4).replace(/\./g, "_");
  return `${fmt(b[0])}_${fmt(b[1])}__${fmt(b[2])}_${fmt(b[3])}`;
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

function resolveTrack(trackId: string): TrackRow {
  const t = getTrack(trackId);
  if (!t) throw new Error(`Traccia "${trackId}" non trovata nel database`);
  return t;
}

/**
 * Snapshot Overpass → POI precomputati per una traccia.
 * @returns numero totale POI in DB per la traccia
 */
export async function runPoiSnapshotForTrack(
  trackId: string,
  opts?: SnapshotPoiRunOptions
): Promise<number> {
  const log = opts?.log ?? ((m: string) => console.log(m));
  const track = resolveTrack(trackId);
  const coords = (JSON.parse(track.coords_json) as [number, number, number | null, number][]).map(
    (c) => {
      const p: Position = [c[0], c[1]];
      if (c[2] != null) p.push(c[2]);
      return p;
    }
  );

  const GRID_COLS = opts?.gridCols ?? envInt("HMR_SNAPSHOT_GRID_COLS", 4);
  const GRID_ROWS = opts?.gridRows ?? envInt("HMR_SNAPSHOT_GRID_ROWS", 5);
  const BBOX_PAD_DEG = opts?.bboxPadDeg ?? envFloat("HMR_SNAPSHOT_BBOX_PAD", 0.03);
  const BETWEEN_CALLS_MS = opts?.pauseMs ?? envInt("HMR_SNAPSHOT_PAUSE_MS", 600);
  const MAX_ATTEMPTS = opts?.maxAttempts ?? envInt("HMR_SNAPSHOT_RETRIES", 2);
  const SPLIT_MAX_DEPTH = opts?.splitMaxDepth ?? envInt("HMR_SNAPSHOT_SPLIT_DEPTH", 4);
  const CONCURRENCY = Math.max(
    1,
    Math.min(4, opts?.concurrency ?? envInt("HMR_SNAPSHOT_CONCURRENCY", 1))
  );
  const CACHE_DIR = opts?.cacheDir ?? path.join(process.cwd(), ".ingest-cache");
  const appendOnly = opts?.appendOnly ?? false;

  const chunkCachePath = (key: string, cell: Bbox) => {
    const dir = path.join(CACHE_DIR, key);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${cellId(cell)}.json`);
  };

  const loadCachedCell = (file: string): OsmNode[] | null => {
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as OsmNode[];
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const fetchCellWithRetry = async (
    key: BboxCategoryKey,
    cell: Bbox,
    depth = 0
  ): Promise<OsmNode[]> => {
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
            const sub: Bbox[] = [
              [s, w, latMid, lngMid],
              [s, lngMid, latMid, e2],
              [latMid, w, n, lngMid],
              [latMid, lngMid, n, e2],
            ];
            const acc: OsmNode[] = [];
            for (const c of sub) acc.push(...(await fetchCellWithRetry(key, c, depth + 1)));
            fs.writeFileSync(cacheFile, JSON.stringify(acc));
            return acc;
          }
          return [];
        }
        const retryAfter =
          e instanceof OverpassError && typeof e.retryAfterSec === "number"
            ? e.retryAfterSec * 1000
            : 0;
        const base = retryAfter > 0 ? retryAfter : Math.min(20_000, 1500 * Math.pow(2, attempt - 1));
        await sleep(base + Math.floor(Math.random() * 1500));
      }
    }
  };

  const collectCategory = async (key: BboxCategoryKey, cells: Bbox[]): Promise<OsmNode[]> => {
    const acc: OsmNode[] = [];
    const seen = new Set<string>();
    let index = 0;
    const worker = async () => {
      while (true) {
        const i = index++;
        if (i >= cells.length) return;
        const nodes = await fetchCellWithRetry(key, cells[i]!);
        for (const n of nodes) {
          if (n.lat == null || n.lon == null) continue;
          const k = `${n.type}:${n.id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          acc.push(n);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    return acc;
  };

  log(`[snapshot] Track: ${track.name} · ${coords.length} vertici · ${track.length_km.toFixed(1)} km`);

  const cum = cumulativeKmAlong(coords);
  const bbox = trackBbox(coords, BBOX_PAD_DEG);
  const cells = splitBbox(bbox, GRID_COLS, GRID_ROWS);
  log(`[snapshot] grid ${GRID_COLS}x${GRID_ROWS} = ${cells.length} celle`);

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  const onlyKeys = opts?.onlyKeys ?? null;
  const plans = onlyKeys ? PLAN.filter((p) => onlyKeys.includes(p.key)) : PLAN;

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
      db.prepare(`DELETE FROM pois WHERE track_id = ? AND category IN (${ph})`).run(
        track.id,
        ...cats
      );
    }
    log(`[snapshot] ▶ ${plan.key}`);
    let nodes: OsmNode[];
    try {
      nodes = await collectCategory(plan.key, cells);
    } catch (e) {
      log(`[snapshot] ✖ ${plan.key}: ${(e as Error).message}`);
      continue;
    }

    const txn = db.transaction((list: OsmNode[]) => {
      for (const n of list) {
        if (n.lat == null || n.lon == null) continue;
        const tags = n.tags ?? {};
        const klass = classifyOsm(tags);
        if (!klass) continue;
        const projected = nearestPointOnPolyline(coords, [n.lon, n.lat], cum);
        if (!projected) continue;
        const detourM = Math.round(projected.distKm * 1000);
        if (detourM > plan.maxDetourM) continue;
        const elevTrack = elevForIdx(projected.segIndex) ?? elevForIdx(projected.segIndex + 1);
        const elevPoi = tags.ele ? parseFloat(tags.ele) : null;
        const elevDelta =
          elevTrack != null && elevPoi != null && Number.isFinite(elevPoi)
            ? Math.round(elevPoi - elevTrack)
            : null;
        const id = uuidv5(`${n.type}:${n.id}`, POI_NAMESPACE);
        insert.run(
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
      }
    });
    txn(nodes);
  }

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM pois WHERE track_id = ?`).get(track.id) as { n: number }
  ).n;
  log(`[snapshot] totale POI: ${total}`);
  return total;
}
