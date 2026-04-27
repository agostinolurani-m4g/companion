import type { MapillaryAlongItem } from "@/lib/along-media-types";
import {
  geoCacheGet,
  geoCacheSet,
  geoMapillaryCacheKey,
} from "@/lib/db";
import { polylineBetween } from "@/lib/track-measure";
import { cumFromStored, coordsFromStored, type StoredCoord } from "@/lib/track-coords";
import { nearestPointOnPolyline } from "@/lib/track-geometry";

export type { MapillaryAlongItem } from "@/lib/along-media-types";

type MlyPoint = { type: "Point"; coordinates: [number, number] };

type MlyImage = {
  id: string;
  thumb_256_url?: string;
  computed_geometry?: MlyPoint;
  geometry?: MlyPoint;
};

function padBbox(
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  padDeg: number
): { west: number; south: number; east: number; north: number } {
  return {
    west: bbox.minLng - padDeg,
    south: bbox.minLat - padDeg,
    east: bbox.maxLng + padDeg,
    north: bbox.maxLat + padDeg,
  };
}

function bboxFromSegment(stored: StoredCoord[], kmMin: number, kmMax: number): {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
} | null {
  const lo = Math.min(kmMin, kmMax);
  const hi = Math.max(kmMin, kmMax);
  const seg = polylineBetween(stored, lo, hi);
  if (seg.length === 0) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of seg) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  if (!Number.isFinite(minLng)) return null;
  return { minLng, maxLng, minLat, maxLat };
}

export async function collectMapillaryAlongTrack(opts: {
  storedCoords: StoredCoord[];
  /** Bbox traccia intera (fallback se `kmWindow` assente). */
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  /** Se impostata, query Mapillary solo su bbox del tratto (meno rumore). */
  kmWindow?: { kmMin: number; kmMax: number };
  accessToken: string;
  maxDetourM: number;
  maxItems: number;
  bboxPadDeg?: number;
}): Promise<MapillaryAlongItem[]> {
  const {
    storedCoords,
    bbox,
    kmWindow,
    accessToken,
    maxDetourM,
    maxItems,
    bboxPadDeg = 0.02,
  } = opts;
  const coords = coordsFromStored(storedCoords);
  if (coords.length < 2) return [];
  const cum = cumFromStored(storedCoords);
  const segBbox =
    kmWindow != null ? bboxFromSegment(storedCoords, kmWindow.kmMin, kmWindow.kmMax) : null;
  const queryBbox = segBbox ?? bbox;
  const { west, south, east, north } = padBbox(queryBbox, bboxPadDeg);
  const cacheKey = geoMapillaryCacheKey(west, south, east, north);

  let data: unknown = geoCacheGet(cacheKey);
  if (data == null) {
    const u = new URL("https://graph.mapillary.com/images");
    u.searchParams.set("bbox", `${west},${south},${east},${north}`);
    u.searchParams.set("limit", "200");
    u.searchParams.set(
      "fields",
      "id,thumb_256_url,computed_geometry,geometry"
    );
    u.searchParams.set("access_token", accessToken);
    const res = await fetch(u.toString(), {
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Mapillary HTTP ${res.status} ${t.slice(0, 200)}`);
    }
    data = await res.json();
    geoCacheSet(cacheKey, data);
  }

  const body = data as { data?: MlyImage[] };
  const rows = Array.isArray(body.data) ? body.data : [];
  const maxDetourKm = maxDetourM / 1000;
  const seen = new Set<string>();
  const out: MapillaryAlongItem[] = [];
  const winLo =
    kmWindow != null ? Math.min(kmWindow.kmMin, kmWindow.kmMax) : -Infinity;
  const winHi =
    kmWindow != null ? Math.max(kmWindow.kmMin, kmWindow.kmMax) : Infinity;

  for (const im of rows) {
    if (!im?.id) continue;
    const g = im.computed_geometry ?? im.geometry;
    if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) continue;
    const [lng, lat] = g.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const proj = nearestPointOnPolyline(coords, [lng, lat], cum);
    if (!proj || proj.distKm > maxDetourKm) continue;
    if (proj.alongKm < winLo - 0.05 || proj.alongKm > winHi + 0.05) continue;
    if (seen.has(im.id)) continue;
    seen.add(im.id);
    out.push({
      id: im.id,
      lat,
      lng,
      along_km: Number(proj.alongKm.toFixed(2)),
      detour_m: Math.round(proj.distKm * 1000),
      thumb_url: im.thumb_256_url ?? null,
    });
    if (out.length >= maxItems) break;
  }

  out.sort((a, b) => a.along_km - b.along_km);
  return out;
}
