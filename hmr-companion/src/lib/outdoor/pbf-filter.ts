/** Filtri puri per l'import outdoor da PBF (bbox, linee trail, copertura tile). */
import { lngLatToTile, tileBbox, tilesZ10ForBbox } from "./tiles";

/**
 * Gestione del gruppo `trail` (linee):
 * - `all`: tutte;
 * - `hiking` (default): sentieri, mulattiere/forestali, piste, itinerari — esclude footway
 *   (marciapiedi/cammini urbani), steps, cycleway, bridleway;
 * - `none`: nessuna linea trail (restano hazard, ferrate, funivie).
 */
export type TrailMode = "all" | "hiking" | "none";

export const HIKING_TRAIL_KINDS = new Set([
  "path_hiking",
  "path_mtb",
  "track",
  "piste_downhill",
  "piste_nordic",
  "piste_skitour",
  "piste_hike",
  "route_hiking",
  "route_mtb",
]);

export function parseTrailMode(raw: string | undefined): TrailMode {
  const v = raw?.trim().toLowerCase();
  if (!v) return "hiking";
  if (v === "all" || v === "hiking" || v === "none") return v;
  throw new Error(`OUTDOOR_TRAILS non valido "${raw}": usa all | hiking | none`);
}

export function parseKindList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function kindAllowed(group: string, kind: string, mode: TrailMode, exclude: Set<string>): boolean {
  if (exclude.has(kind)) return false;
  if (group !== "trail") return true;
  if (mode === "all") return true;
  if (mode === "none") return false;
  return HIKING_TRAIL_KINDS.has(kind);
}

export type GeoBbox = { west: number; south: number; east: number; north: number };

/** Sotto-griglia usata per verificare che il PBF copra davvero un tile z10 (8×8 celle z13). */
export const COVERAGE_Z = 13;

export function coverageCellKey(lng: number, lat: number): number {
  const t = lngLatToTile(lng, lat, COVERAGE_Z);
  return t.x * 2 ** COVERAGE_Z + t.y;
}

/**
 * Tile z10 da marcare come coperti: interamente dentro la bbox e con almeno un nodo OSM
 * del PBF in ognuna delle 64 celle z13 (esclude i tile di confine di un estratto nazionale,
 * che continueranno a essere riempiti via Overpass).
 */
export function fullyCoveredTilesZ10(bbox: GeoBbox, coveredCells: Set<number>): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const f = 2 ** (COVERAGE_Z - 10);
  for (const t of tilesZ10ForBbox(bbox.south, bbox.west, bbox.north, bbox.east)) {
    const b = tileBbox(10, t.x, t.y);
    if (b.west < bbox.west || b.east > bbox.east || b.south < bbox.south || b.north > bbox.north) continue;
    let ok = true;
    for (let i = 0; i < f && ok; i++) {
      for (let j = 0; j < f && ok; j++) {
        if (!coveredCells.has((t.x * f + i) * 2 ** COVERAGE_Z + (t.y * f + j))) ok = false;
      }
    }
    if (ok) out.push(t);
  }
  return out;
}
