import type { Feature, LineString } from "geojson";
import type { UserRouteActivity } from "@/lib/db";
import {
  lineLengthKm,
} from "@/lib/osrm-route";
import {
  mergeRouteTechParts,
  parseOrsExtras,
  type OrsExtrasRaw,
  type RouteTech,
} from "@/lib/ors-route-tech";

export type OrsProfile = "cycling-road" | "cycling-mountain" | "foot-hiking";

export type OrsRouteMeta = {
  mode: "single_request" | "chained_segments";
  profileUsed: OrsProfile;
};

export function activityToOrsProfile(activity: UserRouteActivity): OrsProfile {
  switch (activity) {
    case "road":
    case "gravel":
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
  return activity === "road" || activity === "mtb" || activity === "hike" || activity === "gravel";
}

type OrsFetchResult = {
  feature: Feature<LineString>;
  extras?: OrsExtrasRaw;
};

function featureCollectionToResult(j: GeoJSON.FeatureCollection): OrsFetchResult | null {
  const feat = j.features?.[0];
  const g = feat?.geometry;
  if (!g) return null;

  const props = (feat.properties ?? {}) as { extras?: OrsExtrasRaw };
  const extras = props.extras;

  if (g.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    return {
      feature: {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: g.coordinates as [number, number][] },
      },
      extras,
    };
  }
  if (g.type === "MultiLineString" && Array.isArray(g.coordinates)) {
    const merged: [number, number][] = [];
    for (const line of g.coordinates as [number, number][][]) {
      for (const c of line) merged.push(c);
    }
    if (merged.length < 2) return null;
    return {
      feature: {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: merged },
      },
      extras,
    };
  }
  return null;
}

async function fetchOrsOnce(
  coordinates: [number, number][],
  profile: OrsProfile,
  apiKey: string
): Promise<OrsFetchResult | null> {
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
      extra_info: ["surface", "waytype", "steepness", "traildifficulty"],
    }),
    next: { revalidate: 0 },
  });
  const j = (await res.json()) as { error?: { code?: number; message?: string }; type?: string };
  if (!res.ok || j.error) return null;
  if (j.type !== "FeatureCollection" || !("features" in j)) return null;
  return featureCollectionToResult(j as GeoJSON.FeatureCollection);
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
): Promise<{ feature: Feature<LineString>; meta: OrsRouteMeta; tech: RouteTech | null } | null> {
  if (coordinates.length < 2) return null;
  const profile = activityToOrsProfile(activity);

  const single = await fetchOrsOnce(coordinates, profile, apiKey);
  if (single?.feature?.geometry?.coordinates?.length) {
    const coords = single.feature.geometry.coordinates as [number, number][];
    const tech = parseOrsExtras(coords, single.extras);
    return {
      feature: single.feature,
      meta: { mode: "single_request", profileUsed: profile },
      tech,
    };
  }

  const segmentCoords: [number, number][][] = [];
  const techParts: RouteTech[] = [];
  let kmOffset = 0;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const leg = await fetchOrsOnce([coordinates[i], coordinates[i + 1]], profile, apiKey);
    if (!leg?.feature?.geometry?.coordinates?.length) return null;
    const legCoords = leg.feature.geometry.coordinates as [number, number][];
    segmentCoords.push(legCoords);
    techParts.push(parseOrsExtras(legCoords, leg.extras, kmOffset));
    kmOffset += lineLengthKm(legCoords);
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
    tech: mergeRouteTechParts(techParts),
  };
}
