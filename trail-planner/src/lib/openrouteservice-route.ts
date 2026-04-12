import type { Feature, LineString } from "geojson";
import { normalizeActivityForRouting } from "@/lib/osrm-route";

export type OrsRouteMeta = {
  mode: "single_request" | "chained_segments";
  profileUsed: "foot-hiking";
};

/**
 * OpenRoute Service `foot-hiking`: pesa di più su sentieri / fuori asfalto rispetto al solo OSRM `foot`
 * sul server demo (spesso percepito come “solo strada”).
 * Richiede `OPENROUTESERVICE_API_KEY` (registrazione gratuita su openrouteservice.org).
 */
export function activityPrefersOrsFootHiking(activity: string | null | undefined): boolean {
  const a = normalizeActivityForRouting(activity ?? "hiking");
  switch (a) {
    case "hiking":
    case "trail_running":
    case "ski_mountaineering":
    case "nordic_ski":
      return true;
    default:
      return false;
  }
}

function featureCollectionToLineStringFeature(j: GeoJSON.FeatureCollection): Feature<LineString> | null {
  const feat = j.features?.[0];
  const g = feat?.geometry;
  if (!g) return null;
  if (g.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    return {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: g.coordinates as [number, number][] },
    };
  }
  if (g.type === "MultiLineString" && Array.isArray(g.coordinates)) {
    const merged: [number, number][] = [];
    for (const line of g.coordinates as [number, number][][]) {
      for (const c of line) merged.push(c);
    }
    if (merged.length < 2) return null;
    return {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: merged },
    };
  }
  return null;
}

async function fetchOrsFootHikingOnce(
  coordinates: [number, number][],
  apiKey: string
): Promise<Feature<LineString> | null> {
  if (coordinates.length < 2) return null;
  const res = await fetch("https://api.openrouteservice.org/v2/directions/foot-hiking/geojson", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      Accept: "application/geo+json, application/json",
    },
    body: JSON.stringify({
      coordinates,
      preference: "recommended",
      instructions: false,
    }),
    next: { revalidate: 0 },
  });
  const j = (await res.json()) as { error?: { code?: number; message?: string }; type?: string };
  if (!res.ok || j.error) return null;
  if (j.type !== "FeatureCollection" || !("features" in j)) return null;
  return featureCollectionToLineStringFeature(j as GeoJSON.FeatureCollection);
}

/** Unisce segmenti come in OSRM. */
function mergeLineCoordinates(segments: [number, number][][]): [number, number][] {
  const out: [number, number][] = [];
  for (const seg of segments) {
    if (seg.length === 0) continue;
    if (out.length === 0) {
      out.push(...seg);
      continue;
    }
    const [a, b] = [out[out.length - 1], seg[0]];
    const dup = a[0] === b[0] && a[1] === b[1];
    out.push(...(dup ? seg.slice(1) : seg));
  }
  return out;
}

export async function fetchOrsFootHikingLine(
  coordinates: [number, number][],
  apiKey: string
): Promise<{ feature: Feature<LineString>; meta: OrsRouteMeta } | null> {
  if (coordinates.length < 2) return null;

  const single = await fetchOrsFootHikingOnce(coordinates, apiKey);
  if (single?.geometry?.coordinates?.length) {
    return { feature: single, meta: { mode: "single_request", profileUsed: "foot-hiking" } };
  }

  const segmentCoords: [number, number][][] = [];
  for (let i = 0; i < coordinates.length - 1; i++) {
    const leg = await fetchOrsFootHikingOnce([coordinates[i], coordinates[i + 1]], apiKey);
    if (!leg?.geometry?.coordinates?.length) return null;
    segmentCoords.push(leg.geometry.coordinates as [number, number][]);
  }
  const merged = mergeLineCoordinates(segmentCoords);
  if (merged.length < 2) return null;
  return {
    feature: {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: merged },
    },
    meta: { mode: "chained_segments", profileUsed: "foot-hiking" },
  };
}
