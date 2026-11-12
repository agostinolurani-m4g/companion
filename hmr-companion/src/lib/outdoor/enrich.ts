import type Database from "better-sqlite3";
import { searchSkiRoutes, type C2cBbox3857 } from "@/lib/camptocamp";
import { buildPoiDetails, type PoiDetailsResult } from "@/lib/poi-details";
import { commonsPhotosNear } from "./sources/commons-photos";
import { fetchRefugesInfoBbox, refugesInfoKind, refugesInfoMatchGroups } from "./sources/refuges-info";
import { weatherNearPoint } from "./sources/weather-stations";
import {
  deleteOutdoorFeature,
  getFeatureLinks,
  upsertFeatureLink,
  upsertOutdoorFeature,
  type OutdoorFeatureRow,
} from "./store";
import { featureDisplayName, outdoorFeatureId, parseEle } from "./taxonomy";

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLng = (lng2 - lng1) * toR;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function wgsBboxTo3857(south: number, west: number, north: number, east: number): C2cBbox3857 {
  const toX = (lng: number) => (lng * 20037508.34) / 180;
  const toY = (lat: number) => {
    const rad = (lat * Math.PI) / 180;
    return (Math.log(Math.tan(Math.PI / 4 + rad / 2)) * 20037508.34) / Math.PI;
  };
  return { west: toX(west), south: toY(south), east: toX(east), north: toY(north) };
}

export async function enrichFeatureDetail(
  db: Database.Database,
  row: OutdoorFeatureRow,
  tags: Record<string, string>,
): Promise<{
  wiki: PoiDetailsResult;
  commons: Awaited<ReturnType<typeof commonsPhotosNear>>;
  weather: Awaited<ReturnType<typeof weatherNearPoint>>;
  links: ReturnType<typeof getFeatureLinks>;
  camptocamp: unknown[];
}> {
  const wiki = await buildPoiDetails({
    wikidata: tags.wikidata ?? null,
    wikipedia: tags.wikipedia ?? tags["wikipedia:it"] ?? tags["wikipedia:en"] ?? null,
    lat: row.lat,
    lng: row.lng,
  });
  const commons = await commonsPhotosNear(row.lat, row.lng, 800);
  const weather = await weatherNearPoint(row.lat, row.lng);
  const links = getFeatureLinks(db, row.id);

  let camptocamp: unknown[] = [];
  try {
    const pad = 0.08;
    const bbox = wgsBboxTo3857(row.lat - pad, row.lng - pad, row.lat + pad, row.lng + pad);
    const { documents } = await searchSkiRoutes(bbox, { limit: 5 });
    camptocamp = documents;
  } catch {
    camptocamp = [];
  }

  return { wiki, commons, weather, links, camptocamp };
}

export type RefugesInfoImportStats = {
  fetched: number;
  linkedByRef: number;
  linkedByDistance: number;
  created: number;
  skipped: number;
};

/** Distanza massima per collegare un punto refuges.info a una feature OSM dello stesso gruppo. */
const LINK_MAX_M = 150;

/** Stati refuges.info per cui non si crea un nuovo punto (struttura non più utilizzabile). */
const NO_CREATE_STATES = new Set(["Détruite", "Détruit", "Inutilisable", "Tari définitivement"]);

/**
 * Import refuges.info in bbox:
 * 1. collega alla feature OSM con tag `ref:refuges.info` uguale all'id;
 * 2. altrimenti alla feature più vicina (< 150 m) di gruppo compatibile (shelter / water);
 * 3. altrimenti crea un punto `source='refuges.info'` (id `n-<id>`, mai in collisione con OSM).
 * Idempotente: link e punti vengono aggiornati, non duplicati.
 */
export async function importRefugesInfoBbox(
  db: Database.Database,
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<RefugesInfoImportStats> {
  const places = await fetchRefugesInfoBbox(south, west, north, east);
  const stats: RefugesInfoImportStats = {
    fetched: places.length,
    linkedByRef: 0,
    linkedByDistance: 0,
    created: 0,
    skipped: 0,
  };

  const byRef = new Map<string, string>();
  const refRows = db
    .prepare(
      `SELECT id, json_extract(tags_json, '$."ref:refuges.info"') AS r FROM outdoor_features
       WHERE source != 'refuges.info' AND tags_json LIKE '%ref:refuges.info%'`,
    )
    .all() as Array<{ id: string; r: string | number | null }>;
  for (const row of refRows) if (row.r != null) byRef.set(String(row.r).trim(), row.id);

  const nearStmt = db.prepare(
    `SELECT p.id, p.lat, p.lng, p.grp FROM outdoor_features p
     INNER JOIN outdoor_features_rtree r ON r.id = p.rowid
     WHERE r.maxLat >= ? AND r.minLat <= ? AND r.maxLng >= ? AND r.minLng <= ?
       AND p.source != 'refuges.info' AND p.geom_json IS NULL`,
  );

  const tx = db.transaction(() => {
    for (const p of places) {
      const extId = String(p.id);
      // Se nel frattempo esiste la feature OSM, il punto sintetico creato in passato va rimosso.
      const syntheticId = outdoorFeatureId("node", -p.id);
      const refId = byRef.get(extId);
      if (refId) {
        upsertFeatureLink(db, refId, "refuges.info", extId, p);
        deleteOutdoorFeature(db, syntheticId);
        stats.linkedByRef++;
        continue;
      }

      const groups = refugesInfoMatchGroups(p.typeId);
      const d = 0.003;
      const cands = nearStmt.all(p.latitude - d, p.latitude + d, p.longitude - d, p.longitude + d) as Array<{
        id: string;
        lat: number;
        lng: number;
        grp: string;
      }>;
      let best: { id: string; dist: number } | null = null;
      for (const c of cands) {
        if (!groups.includes(c.grp)) continue;
        const dist = haversineM(p.latitude, p.longitude, c.lat, c.lng);
        if (dist < LINK_MAX_M && (!best || dist < best.dist)) best = { id: c.id, dist };
      }
      if (best) {
        upsertFeatureLink(db, best.id, "refuges.info", extId, p);
        deleteOutdoorFeature(db, syntheticId);
        stats.linkedByDistance++;
        continue;
      }

      const k = refugesInfoKind(p.typeId);
      if (!k || NO_CREATE_STATES.has(p.state)) {
        stats.skipped++;
        continue;
      }
      const tags: Record<string, string> = { name: p.name, "ref:refuges.info": extId };
      if (p.altitude != null) tags.ele = String(p.altitude);
      if (p.places != null && p.places > 0) tags.capacity = String(p.places);
      if (p.water != null && k.grp === "shelter") tags.drinking_water = p.water ? "yes" : "no";
      if (p.fireplace != null) tags.fireplace = p.fireplace ? "yes" : "no";
      if (p.stove != null) tags.stove = p.stove ? "yes" : "no";
      const ele = parseEle(tags);
      upsertOutdoorFeature(db, {
        osmType: "node",
        osmId: -p.id,
        grp: k.grp,
        kind: k.kind,
        name: featureDisplayName(tags, k.kind),
        lat: p.latitude,
        lng: p.longitude,
        ele,
        eleSource: ele != null ? "refuges.info" : null,
        tags,
        source: "refuges.info",
      });
      upsertFeatureLink(db, syntheticId, "refuges.info", extId, p);
      stats.created++;
    }
  });
  tx();
  return stats;
}
