/**
 * Resolver POI: SQLite locale (Italia) con fallback automatico a Overpass.
 */
import type { OsmPoiRow, PoiCategory } from "./db";
import {
  localCoverageContainsAround,
  localCoverageContainsBbox,
  localPoiCount,
  queryLocalPoisAround,
  queryLocalPoisInBbox,
} from "./db";
import {
  clampPoiHarvestRadiusM,
  fetchPoiTypesAround,
  fetchPoiTypesInBbox,
  type Bbox,
  type BboxCategoryKey,
  type OsmNode,
} from "./overpass";

const BBOX_KEY_TO_CATEGORIES: Record<BboxCategoryKey, PoiCategory[]> = {
  water: ["water"],
  hut: ["hut"],
  lodging: ["lodging"],
  campsite: ["campsite"],
  shop: ["shop"],
  food: ["restaurant"],
  health: ["pharmacy"],
  utilities: ["atm", "bus"],
};

export type PoiSource = "local" | "overpass";

export function poiCategoriesFromBboxKeys(keys: BboxCategoryKey[] | null): PoiCategory[] | null {
  if (!keys || keys.length === 0) return null;
  const set = new Set<PoiCategory>();
  for (const k of keys) {
    for (const c of BBOX_KEY_TO_CATEGORIES[k]) set.add(c);
  }
  return set.size > 0 ? Array.from(set) : null;
}

function rowToOsmNode(row: OsmPoiRow): OsmNode {
  let tags: Record<string, string> = {};
  try {
    tags = JSON.parse(row.tags_json) as Record<string, string>;
  } catch {
    tags = {};
  }
  return {
    type: row.osm_type,
    id: row.osm_id,
    lat: row.lat,
    lon: row.lng,
    tags,
  };
}

export async function getPoiTypesInBbox(
  bbox: Bbox,
  bboxKeys: BboxCategoryKey[] | null
): Promise<{ nodes: OsmNode[]; source: PoiSource }> {
  const [south, west, north, east] = bbox;
  if (localPoiCount() > 0 && localCoverageContainsBbox(south, west, north, east)) {
    const categories = poiCategoriesFromBboxKeys(bboxKeys);
    const rows = queryLocalPoisInBbox(south, west, north, east, categories);
    return { nodes: rows.map(rowToOsmNode), source: "local" };
  }
  const nodes = await fetchPoiTypesInBbox(bbox, bboxKeys);
  return { nodes, source: "overpass" };
}

export async function getPoiTypesAround(
  lat: number,
  lng: number,
  radiusM: number,
  bboxKeys: BboxCategoryKey[] | null
): Promise<{ nodes: OsmNode[]; source: PoiSource }> {
  const rEff = clampPoiHarvestRadiusM(radiusM);
  if (localPoiCount() > 0 && localCoverageContainsAround(lat, lng, rEff)) {
    const categories = poiCategoriesFromBboxKeys(bboxKeys);
    const rows = queryLocalPoisAround(lat, lng, rEff, categories);
    return { nodes: rows.map(rowToOsmNode), source: "local" };
  }
  const nodes = await fetchPoiTypesAround(lat, lng, radiusM, bboxKeys);
  return { nodes, source: "overpass" };
}
