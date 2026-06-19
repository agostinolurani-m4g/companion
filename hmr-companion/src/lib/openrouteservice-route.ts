import type { Feature, LineString } from "geojson";
import type { UserRouteActivity } from "@/lib/db";

export type OrsProfile = "cycling-road" | "cycling-mountain" | "foot-hiking";

export type OrsRouteMeta = {
  mode: "single_request" | "chained_segments";
  profileUsed: OrsProfile;
};

export function activityToOrsProfile(activity: UserRouteActivity): OrsProfile {
  switch (activity) {
    case "road":
      return "cycling-road";
    case "mtb":
      return "cycling-mountain";
    case "hike":
      return "foot-hiking";
    default:
      return "foot-hiking";
  }
}

export function activityPrefersOrs(activity: UserRouteActivity): boolean {
  return activity === "road" || activity === "mtb" || activity === "hike";
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

async function fetchOrsOnce(
  coordinates: [number, number][],
  profile: OrsProfile,
  apiKey: string
): Promise<Feature<LineString> | null> {
  if (coordinates.length < 2) return null;
  const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
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

export async function fetchOrsRouteLine(
  coordinates: [number, number][],
  activity: UserRouteActivity,
  apiKey: string
): Promise<{ feature: Feature<LineString>; meta: OrsRouteMeta } | null> {
  if (coordinates.length < 2) return null;
  const profile = activityToOrsProfile(activity);

  const single = await fetchOrsOnce(coordinates, profile, apiKey);
  if (single?.geometry?.coordinates?.length) {
    return { feature: single, meta: { mode: "single_request", profileUsed: profile } };
  }

  const segmentCoords: [number, number][][] = [];
  for (let i = 0; i < coordinates.length - 1; i++) {
    const leg = await fetchOrsOnce([coordinates[i], coordinates[i + 1]], profile, apiKey);
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
    meta: { mode: "chained_segments", profileUsed: profile },
  };
}
