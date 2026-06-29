import type { Feature, LineString } from "geojson";
import type { UserRouteActivity } from "@/lib/db";

/** Profili OSRM sul server demo pubblico. */
export type OsrmProfile = "driving" | "walking" | "cycling" | "foot";

function haversineKmLngLat(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function interpolateLngLat(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function densifyCoordinatesForRouting(
  coordinates: [number, number][],
  maxLegKm = 26,
  maxVertices = 44,
  depth = 0
): [number, number][] {
  if (coordinates.length < 2) return coordinates;
  const out: [number, number][] = [coordinates[0]];
  for (let i = 0; i < coordinates.length - 1; i++) {
    const a = coordinates[i];
    const b = coordinates[i + 1];
    const dist = haversineKmLngLat(a, b);
    if (dist <= maxLegKm) {
      out.push(b);
      continue;
    }
    const nSeg = Math.max(1, Math.ceil(dist / maxLegKm));
    for (let k = 1; k < nSeg; k++) {
      out.push(interpolateLngLat(a, b, k / nSeg));
    }
    out.push(b);
  }
  if (out.length <= maxVertices) return out;
  if (depth > 5) return coordinates;
  return densifyCoordinatesForRouting(coordinates, maxLegKm * 1.75, maxVertices, depth + 1);
}

export type OsrmRouteMeta = {
  mode: "single_request" | "chained_segments";
  profileUsed: OsrmProfile;
};

function shouldDensifyOsrmLegs(profile: OsrmProfile): boolean {
  return profile === "cycling" || profile === "foot" || profile === "walking";
}

async function fetchOsrmRouteLineOnce(
  coordinates: [number, number][],
  profile: OsrmProfile
): Promise<Feature<LineString> | null> {
  if (coordinates.length < 2) return null;
  const path = coordinates.map((c) => `${c[0]},${c[1]}`).join(";");
  const href = `https://router.project-osrm.org/route/v1/${profile}/${path}?overview=full&geometries=geojson`;
  const res = await fetch(href, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    code?: string;
    routes?: { geometry: { type: string; coordinates: [number, number][] } }[];
  };
  if (j.code !== "Ok" || !j.routes?.[0]?.geometry) return null;
  const g = j.routes[0].geometry;
  if (g.type !== "LineString" || !Array.isArray(g.coordinates)) return null;
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: g.coordinates },
  };
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

async function fetchOsrmRouteLineForProfile(
  coordinates: [number, number][],
  profile: OsrmProfile
): Promise<{ feature: Feature<LineString>; meta: Omit<OsrmRouteMeta, "profileUsed"> } | null> {
  if (coordinates.length < 2) return null;

  let coords = coordinates;
  if (shouldDensifyOsrmLegs(profile)) {
    coords = densifyCoordinatesForRouting(coordinates);
  }

  const single = await fetchOsrmRouteLineOnce(coords, profile);
  if (single) {
    return { feature: single, meta: { mode: "single_request" } };
  }

  const segmentCoords: [number, number][][] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const leg = await fetchOsrmRouteLineOnce([coords[i], coords[i + 1]], profile);
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
    meta: { mode: "chained_segments" },
  };
}

export async function fetchOsrmRouteLine(
  coordinates: [number, number][],
  profile: OsrmProfile
): Promise<{ feature: Feature<LineString>; meta: OsrmRouteMeta } | null> {
  const attempt = async (p: OsrmProfile): Promise<{ feature: Feature<LineString>; meta: OsrmRouteMeta } | null> => {
    const r = await fetchOsrmRouteLineForProfile(coordinates, p);
    if (!r) return null;
    return { feature: r.feature, meta: { ...r.meta, profileUsed: p } };
  };

  let out = await attempt(profile);
  if (!out && profile === "foot") {
    out = await attempt("walking");
  }
  return out;
}

export function activityToOsrmProfile(activity: UserRouteActivity): OsrmProfile {
  switch (activity) {
    case "road":
    case "mtb":
    case "gravel":
      return "cycling";
    case "hike":
      return "foot";
    default:
      return "foot";
  }
}

export function lineLengthKm(coords: [number, number][]): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    sum += haversineKmLngLat(coords[i - 1], coords[i]);
  }
  return sum;
}
