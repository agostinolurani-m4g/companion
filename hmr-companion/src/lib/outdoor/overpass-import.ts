import type Database from "better-sqlite3";
import { fetchOverpassRawElements } from "@/lib/overpass";
import { simplifyLineString } from "@/lib/line-simplify";
import {
  classifyOutdoor,
  featureDisplayName,
  parseEle,
  type OsmElementType,
} from "./taxonomy";
import { outdoorOverpassQuery } from "./overpass-query";
import { markOutdoorTile, upsertOutdoorFeatureBatch, type UpsertOutdoorFeatureInput } from "./store";
import { tileBbox } from "./tiles";

type OverpassEl = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: Array<{ type: string; ref: number; role?: string; lat?: number; lon?: number }>;
};

function osmType(el: OverpassEl): OsmElementType | null {
  if (el.type === "node") return "node";
  if (el.type === "way") return "way";
  if (el.type === "relation") return "relation";
  return null;
}

function elementToFeature(el: OverpassEl): UpsertOutdoorFeatureInput | null {
  const ot = osmType(el);
  if (!ot) return null;
  const tags = el.tags ?? {};
  const c = classifyOutdoor(ot, tags);
  if (!c) return null;

  let lat: number | undefined;
  let lng: number | undefined;
  let geomJson: string | null = null;
  let bbox: UpsertOutdoorFeatureInput["bbox"];

  if (ot === "node") {
    lat = el.lat;
    lng = el.lon;
  } else if (el.center) {
    lat = el.center.lat;
    lng = el.center.lon;
  }

  const geom = el.geometry;
  if (geom && geom.length >= 2) {
    const coords = geom.map((p) => ({ lat: p.lat, lng: p.lon }));
    lat = coords.reduce((s, p) => s + p.lat, 0) / coords.length;
    lng = coords.reduce((s, p) => s + p.lng, 0) / coords.length;
    if (c.geom === "line") {
      const positions = coords.map((p) => [p.lng, p.lat] as [number, number]);
      const simplified = simplifyLineString(positions, 0.00008);
      geomJson = JSON.stringify({ type: "LineString", coordinates: simplified });
    }
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const p of coords) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }
    bbox = { minLat, maxLat, minLng, maxLng };
  }

  if (lat == null || lng == null) return null;

  return {
    osmType: ot,
    osmId: el.id,
    grp: c.group,
    kind: c.kind,
    name: featureDisplayName(tags, c.kind),
    lat,
    lng,
    ele: parseEle(tags),
    tags,
    geomJson,
    bbox,
    source: "overpass",
  };
}

export async function importOutdoorOverpassBbox(
  db: Database.Database,
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<number> {
  const q = outdoorOverpassQuery(south, west, north, east);
  const raw = await fetchOverpassRawElements(q);
  const rows: UpsertOutdoorFeatureInput[] = [];
  for (const el of raw as OverpassEl[]) {
    const f = elementToFeature(el);
    if (f) rows.push(f);
  }
  upsertOutdoorFeatureBatch(db, rows);
  return rows.length;
}

const fillQueue = new Set<string>();
let fillsInFlight = 0;
const MAX_CONCURRENT = 1;
const MAX_PER_MINUTE = 3;
let recentFills: number[] = [];

function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

function canStartFill(): boolean {
  const now = Date.now();
  recentFills = recentFills.filter((t) => now - t < 60_000);
  return fillsInFlight < MAX_CONCURRENT && recentFills.length < MAX_PER_MINUTE;
}

/** Accoda tile z10 mancanti; esegue in background (best effort). */
export function enqueueOutdoorTileFill(
  db: Database.Database,
  tiles: Array<{ x: number; y: number }>,
): void {
  for (const t of tiles) {
    const key = tileKey(10, t.x, t.y);
    if (fillQueue.has(key)) continue;
    fillQueue.add(key);
    void drainQueue(db);
  }
}

async function drainQueue(db: Database.Database): Promise<void> {
  if (!canStartFill()) return;
  const next = [...fillQueue][0];
  if (!next) return;
  const [, xs, ys] = next.split("/");
  const x = Number(xs);
  const y = Number(ys);
  fillQueue.delete(next);
  fillsInFlight++;
  recentFills.push(Date.now());
  try {
    const { south, west, north, east } = tileBbox(10, x, y);
    const n = await importOutdoorOverpassBbox(db, south, west, north, east);
    markOutdoorTile(db, 10, x, y, "overpass");
    console.log(`[outdoor:tile] z10/${x}/${y} +${n} features`);
  } catch (e) {
    console.warn(`[outdoor:tile] fill failed ${next}`, e);
  } finally {
    fillsInFlight--;
    if (fillQueue.size > 0) void drainQueue(db);
  }
}
