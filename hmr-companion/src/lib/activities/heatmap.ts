import type Database from "better-sqlite3";
import { haversineM } from "./geo";
import { parseActivityLine, setActivityHeatScopes, type ActivityRow } from "./store";

/**
 * Heatmap a griglia in metri Web Mercator.
 *
 * - Ogni attività contribuisce **1** per cella attraversata (dedup per attività).
 * - Scope `u:<owner>` = heatmap personale (tutte le attività, Strava incluse).
 * - Scope `community` = attività con consenso (Strava inclusa, attivo di default):
 *   mostra solo QUANTO è battuta una strada, mai la traccia del singolo. Per non
 *   rivelare casa/partenza, i primi e gli ultimi COMMUNITY_TRIM_M metri non entrano.
 */

export const HEAT_CELL_M = 32;
const OFFSET = 1 << 20;
const EARTH_R = 6378137;
const DENSIFY_STEP_M = 8;
/** Zona privacy: metri tagliati a inizio e fine traccia nella heatmap community. */
export const COMMUNITY_TRIM_M = 300;

export const COMMUNITY_SCOPE = "community";
export function personalScope(owner: string): string {
  return `u:${owner}`;
}

export function lngLatToCell(lng: number, lat: number): [number, number] {
  const x = (EARTH_R * lng * Math.PI) / 180;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y = EARTH_R * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
  return [Math.floor(x / HEAT_CELL_M) + OFFSET, Math.floor(y / HEAT_CELL_M) + OFFSET];
}

export function cellToLngLat(cx: number, cy: number): [number, number] {
  const x = (cx - OFFSET) * HEAT_CELL_M;
  const y = (cy - OFFSET) * HEAT_CELL_M;
  const lng = (x / EARTH_R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2) * (180 / Math.PI);
  return [lng, lat];
}

/** Campiona la linea ogni `stepM` metri (interpolazione lineare in gradi). */
export function densify(coords: GeoJSON.Position[], stepM = DENSIFY_STEP_M): [number, number][] {
  const out: [number, number][] = [];
  if (coords.length === 0) return out;
  out.push([coords[0][0], coords[0][1]]);
  for (let i = 1; i < coords.length; i++) {
    const [aLng, aLat] = coords[i - 1];
    const [bLng, bLat] = coords[i];
    const d = haversineM(aLng, aLat, bLng, bLat);
    const n = Math.max(1, Math.ceil(d / stepM));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      out.push([aLng + (bLng - aLng) * f, aLat + (bLat - aLat) * f]);
    }
  }
  return out;
}

export function cellsForLine(coords: GeoJSON.Position[]): Set<string> {
  const cells = new Set<string>();
  for (const [lng, lat] of densify(coords)) {
    const [cx, cy] = lngLatToCell(lng, lat);
    cells.add(`${cx}:${cy}`);
  }
  return cells;
}

/** Scope in cui l'attività DEVE comparire, dato provider e consenso. */
export function desiredHeatScopes(row: Pick<ActivityRow, "owner" | "provider" | "community_consent">): string[] {
  const scopes = [personalScope(row.owner)];
  if (row.community_consent === 1) scopes.push(COMMUNITY_SCOPE);
  return scopes;
}

/** Taglia `trimM` metri da inizio e fine (vuoto se la traccia è troppo corta). */
export function trimLineEnds(coords: GeoJSON.Position[], trimM: number): GeoJSON.Position[] {
  if (trimM <= 0 || coords.length < 2) return coords;
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]));
  }
  const total = cum[cum.length - 1];
  if (total <= trimM * 2) return [];
  const at = (d: number): GeoJSON.Position => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const f = (d - cum[i - 1]) / seg;
    const [aLng, aLat] = coords[i - 1];
    const [bLng, bLat] = coords[i];
    return [aLng + (bLng - aLng) * f, aLat + (bLat - aLat) * f];
  };
  const start = trimM;
  const end = total - trimM;
  const out: GeoJSON.Position[] = [at(start)];
  for (let i = 0; i < coords.length; i++) if (cum[i] > start && cum[i] < end) out.push(coords[i]);
  out.push(at(end));
  return out;
}

/** Celle dell'attività per uno scope (la community esclude le zone privacy). */
function cellsForScope(coords: GeoJSON.Position[], scope: string): Set<string> {
  return scope === COMMUNITY_SCOPE ? cellsForLine(trimLineEnds(coords, COMMUNITY_TRIM_M)) : cellsForLine(coords);
}

function parseScopes(raw: string): string[] {
  return raw ? raw.split(",").filter(Boolean) : [];
}

function applyCells(
  db: Database.Database,
  scope: string,
  sport: string,
  cells: Set<string>,
  delta: 1 | -1,
  now: number,
): void {
  if (delta === 1) {
    const up = db.prepare(
      `INSERT INTO heat_cells (scope, sport, cx, cy, hits, last_seen) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(scope, sport, cx, cy) DO UPDATE SET hits = hits + 1, last_seen = MAX(last_seen, excluded.last_seen)`,
    );
    for (const key of cells) {
      const [cx, cy] = key.split(":").map(Number);
      up.run(scope, sport, cx, cy, now);
    }
  } else {
    const down = db.prepare(`UPDATE heat_cells SET hits = hits - 1 WHERE scope = ? AND sport = ? AND cx = ? AND cy = ?`);
    for (const key of cells) {
      const [cx, cy] = key.split(":").map(Number);
      down.run(scope, sport, cx, cy);
    }
    db.prepare(`DELETE FROM heat_cells WHERE scope = ? AND sport = ? AND hits <= 0`).run(scope, sport);
  }
}

/**
 * Porta le celle dell'attività allo stato desiderato (idempotente): aggiunge
 * gli scope mancanti, rimuove quelli non più consentiti (es. consenso revocato).
 */
export function syncActivityHeat(db: Database.Database, row: ActivityRow): string[] {
  const current = parseScopes(row.heat_scopes);
  const desired = desiredHeatScopes(row);
  const toAdd = desired.filter((s) => !current.includes(s));
  const toRemove = current.filter((s) => !desired.includes(s));
  if (toAdd.length === 0 && toRemove.length === 0) return current;
  const coords = parseActivityLine(row).coordinates;
  const seen = row.start_time || Date.now();
  db.transaction(() => {
    for (const s of toAdd) applyCells(db, s, row.sport, cellsForScope(coords, s), 1, seen);
    for (const s of toRemove) applyCells(db, s, row.sport, cellsForScope(coords, s), -1, seen);
    setActivityHeatScopes(db, row.id, desired);
  })();
  return desired;
}

/** Rimuove tutti i contributi dell'attività (prima di cancellarla). */
export function removeActivityHeat(db: Database.Database, row: ActivityRow): void {
  const current = parseScopes(row.heat_scopes);
  if (current.length === 0) return;
  const coords = parseActivityLine(row).coordinates;
  db.transaction(() => {
    for (const s of current) applyCells(db, s, row.sport, cellsForScope(coords, s), -1, 0);
    setActivityHeatScopes(db, row.id, []);
  })();
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export type HeatQuery = {
  scope: string;
  bbox: [number, number, number, number];
  zoom: number;
  sports?: string[];
  limit?: number;
};

export type HeatResult = {
  type: "FeatureCollection";
  features: GeoJSON.Feature<GeoJSON.Point, { w: number }>[];
  max: number;
  cell_m: number;
  truncated: boolean;
};

/** Fattore di aggregazione (potenza di 2) per avere celle di almeno ~3 px a schermo. */
export function aggregationFactor(zoom: number): number {
  const mpp = (2 * Math.PI * EARTH_R) / (512 * 2 ** Math.max(0, Math.min(22, zoom)));
  const need = (3 * mpp) / HEAT_CELL_M;
  if (need <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(need));
}

function sportClause(sports: string[] | undefined, args: unknown[]): string {
  if (!sports || sports.length === 0) return "";
  args.push(...sports);
  return ` AND sport IN (${sports.map(() => "?").join(",")})`;
}

export function queryHeat(db: Database.Database, q: HeatQuery): HeatResult {
  const [w, s, e, n] = q.bbox;
  const [x0, y0] = lngLatToCell(w, s);
  const [x1, y1] = lngLatToCell(e, n);
  const f = aggregationFactor(q.zoom);
  const limit = Math.min(Math.max(q.limit ?? 15000, 1), 50000);
  const args: unknown[] = [f, f, q.scope, Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
  const sportSql = sportClause(q.sports, args);
  args.push(limit + 1);
  const rows = db
    .prepare(
      `SELECT cx / ? AS gx, cy / ? AS gy, SUM(hits) AS h
         FROM heat_cells
        WHERE scope = ? AND cx BETWEEN ? AND ? AND cy BETWEEN ? AND ?${sportSql}
        GROUP BY gx, gy
        ORDER BY h DESC
        LIMIT ?`,
    )
    .all(...args) as { gx: number; gy: number; h: number }[];
  const truncated = rows.length > limit;
  const used = truncated ? rows.slice(0, limit) : rows;
  let max = 0;
  const features = used.map((r) => {
    if (r.h > max) max = r.h;
    const [lng, lat] = cellToLngLat(r.gx * f + f / 2, r.gy * f + f / 2);
    return {
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] },
      properties: { w: r.h },
    };
  });
  return { type: "FeatureCollection", features, max, cell_m: HEAT_CELL_M * f, truncated };
}

// ---------------------------------------------------------------------------
// Popolarità di un percorso pianificato
// ---------------------------------------------------------------------------

export type RoutePopularity = {
  /** % della lunghezza su celle già percorse dalla community (0-100). */
  community_pct: number;
  /** % della lunghezza già percorsa dall'utente. */
  personal_pct: number | null;
  /** C'è almeno qualche dato community nella zona del percorso? */
  has_community_data: boolean;
  /** Tratti (> 150 m) mai percorsi dalla community. */
  untrodden: [number, number][][];
};

function loadCellMap(
  db: Database.Database,
  scope: string,
  bbox: [number, number, number, number],
  sports: string[] | undefined,
): Map<string, number> {
  const [x0, y0] = lngLatToCell(bbox[0], bbox[1]);
  const [x1, y1] = lngLatToCell(bbox[2], bbox[3]);
  const args: unknown[] = [scope, Math.min(x0, x1) - 1, Math.max(x0, x1) + 1, Math.min(y0, y1) - 1, Math.max(y0, y1) + 1];
  const sportSql = sportClause(sports, args);
  const rows = db
    .prepare(
      `SELECT cx, cy, SUM(hits) AS h FROM heat_cells
        WHERE scope = ? AND cx BETWEEN ? AND ? AND cy BETWEEN ? AND ?${sportSql}
        GROUP BY cx, cy LIMIT 500000`,
    )
    .all(...args) as { cx: number; cy: number; h: number }[];
  const m = new Map<string, number>();
  for (const r of rows) m.set(`${r.cx}:${r.cy}`, r.h);
  return m;
}

/** Tolleranza GPS: considera "battuta" una cella se lei o una vicina (3×3) ha hits ≥ minHits. */
function nearHits(map: Map<string, number>, cx: number, cy: number): number {
  let best = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const h = map.get(`${cx + dx}:${cy + dy}`) ?? 0;
      if (h > best) best = h;
    }
  }
  return best;
}

export function routePopularity(
  db: Database.Database,
  coords: GeoJSON.Position[],
  opts: { owner?: string; sports?: string[]; minHits?: number } = {},
): RoutePopularity {
  const minHits = opts.minHits ?? 1;
  const samples = densify(coords, 20);
  if (samples.length < 2) {
    return { community_pct: 0, personal_pct: opts.owner ? 0 : null, has_community_data: false, untrodden: [] };
  }
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lng, lat] of samples) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  const bbox: [number, number, number, number] = [w, s, e, n];
  const community = loadCellMap(db, COMMUNITY_SCOPE, bbox, opts.sports);
  const personal = opts.owner ? loadCellMap(db, personalScope(opts.owner), bbox, undefined) : null;

  let total = 0;
  let onCommunity = 0;
  let onPersonal = 0;
  const untrodden: [number, number][][] = [];
  let run: [number, number][] = [];
  let runLen = 0;
  const flush = () => {
    if (run.length >= 2 && runLen >= 150) untrodden.push(run);
    run = [];
    runLen = 0;
  };

  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const d = haversineM(a[0], a[1], b[0], b[1]);
    total += d;
    const [cx, cy] = lngLatToCell((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const isCommunity = nearHits(community, cx, cy) >= minHits;
    if (isCommunity) {
      onCommunity += d;
      flush();
    } else {
      if (run.length === 0) run.push(a);
      run.push(b);
      runLen += d;
    }
    if (personal && nearHits(personal, cx, cy) >= 1) onPersonal += d;
  }
  flush();

  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  return {
    community_pct: pct(onCommunity),
    personal_pct: personal ? pct(onPersonal) : null,
    has_community_data: community.size > 0,
    untrodden: community.size > 0 ? untrodden.map((r) => r.map(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] as [number, number])) : [],
  };
}


export { heatSportFamily } from "./sport-family";
