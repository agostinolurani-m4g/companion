import Database from "better-sqlite3";
import type { Position } from "geojson";
import { v5 as uuidv5 } from "uuid";
import type { PoiCategory, PoiRow } from "./db";
import { nearestPointOnPolyline } from "./track-geometry";
import type { StoredCoord } from "./track-coords";
import {
  classifyOsm,
  osmDescriptionFromTags,
  osmImageFromTags,
  osmOpeningHoursFromTags,
  osmPhoneFromTags,
  osmWebsiteFromTags,
  type OsmNode,
} from "./overpass";

/** Stesso namespace di `scripts/snapshot-pois.ts` (stesso id OSM → stesso UUID riga). */
export const OSM_POI_UUID_NAMESPACE = "f7f5b51a-4c2a-4b6f-9a71-000000000001";

const MAX_DETOUR_M: Record<PoiCategory, number> = {
  water: 800,
  hut: 1500,
  lodging: 3000,
  shop: 2000,
  restaurant: 2000,
  pharmacy: 3000,
  atm: 2500,
  bus: 2500,
};

/**
 * Harvest da click mappa: salva in DB anche POI lontani dal GPX (proiezione sulla traccia),
 * così restano in elenco quando ti avvicini o scrolli la lista.
 */
const HARVEST_RELAXED_MAX_DETOUR_M = 15_000;

export type InsertOsmPoisResult = {
  inserted: number;
  skippedDetour: number;
  skippedUnclassified: number;
  /** OSM classificato ma fuori dalle categorie richieste (filtro harvest). */
  skippedCategoryFilter: number;
  /** Righe appena inserite (INSERT ha dato changes > 0). */
  pois: PoiRow[];
};

export function insertOsmNodesForTrack(
  db: Database.Database,
  trackId: string,
  coords: StoredCoord[],
  nodes: OsmNode[],
  opts?: { allowedCategories?: PoiCategory[]; relaxedDetourForHarvest?: boolean }
): InsertOsmPoisResult {
  const positions: Position[] = coords.map((c) =>
    c[2] != null ? [c[0], c[1], c[2]] : [c[0], c[1]]
  );
  const cum = coords.map((c) => c[3]);
  const elevForIdx = (i: number): number | null => {
    const p = coords[i];
    return typeof p[2] === "number" ? p[2] : null;
  };

  const insert = db.prepare(
    `INSERT OR IGNORE INTO pois
      (id, track_id, category, sub_kind, name, lat, lng, along_km, detour_m, elev_delta_m,
       phone, website, opening_hours, description, image_url, osm_type, osm_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let inserted = 0;
  let skippedDetour = 0;
  let skippedUnclassified = 0;
  let skippedCategoryFilter = 0;
  const pois: PoiRow[] = [];
  const now = Date.now();
  const allowed =
    opts?.allowedCategories && opts.allowedCategories.length > 0
      ? new Set(opts.allowedCategories)
      : null;

  const run = () => {
    for (const n of nodes) {
      if (n.lat == null || n.lon == null) continue;
      const tags = n.tags ?? {};
      const klass = classifyOsm(tags);
      if (!klass) {
        skippedUnclassified += 1;
        continue;
      }
      if (allowed && !allowed.has(klass.category)) {
        skippedCategoryFilter += 1;
        continue;
      }
      const maxM = opts?.relaxedDetourForHarvest
        ? HARVEST_RELAXED_MAX_DETOUR_M
        : MAX_DETOUR_M[klass.category];
      const projected = nearestPointOnPolyline(positions, [n.lon, n.lat], cum);
      if (!projected) continue;
      const detourM = Math.round(projected.distKm * 1000);
      if (detourM > maxM) {
        skippedDetour += 1;
        continue;
      }
      const elevTrack = elevForIdx(projected.segIndex) ?? elevForIdx(projected.segIndex + 1);
      const elevPoi = tags.ele ? parseFloat(tags.ele) : null;
      const elevDelta =
        elevTrack != null && elevPoi != null && Number.isFinite(elevPoi)
          ? Math.round(elevPoi - elevTrack)
          : null;
      const osmUid = `${n.type}:${n.id}`;
      const id = uuidv5(osmUid, OSM_POI_UUID_NAMESPACE);
      const res = insert.run(
        id,
        trackId,
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
        now
      );
      if (res.changes > 0) {
        inserted += 1;
        const row = db.prepare("SELECT * FROM pois WHERE id = ?").get(id) as PoiRow;
        pois.push(row);
      }
    }
  };

  db.transaction(run)();

  return { inserted, skippedDetour, skippedUnclassified, skippedCategoryFilter, pois };
}
