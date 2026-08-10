import type { UserRouteActivity, UserRouteRow } from "@/lib/db";
import { parseSkiGeoJson, routeEndpointsFromSkiGeojson, SKI_TRACK_COLORS } from "@/lib/ski-overlays";

export type ExploreScope = "public" | "mine" | `group:${string}`;

export function parseExploreScope(raw: string | null): ExploreScope | null {
  if (raw === "public" || raw === "mine") return raw;
  if (raw?.startsWith("group:") && raw.length > 6) return raw as `group:${string}`;
  return null;
}

export function parseActivityFilter(raw: string | null): UserRouteActivity | null {
  if (!raw || raw === "all") return null;
  const valid: UserRouteActivity[] = ["road", "mtb", "hike", "gravel", "ski"];
  return valid.includes(raw as UserRouteActivity) ? (raw as UserRouteActivity) : null;
}

const ACTIVITY_COLORS: Record<UserRouteActivity, string> = {
  road: "#60a5fa",
  mtb: "#34d399",
  hike: "#fbbf24",
  gravel: "#a78bfa",
  ski: SKI_TRACK_COLORS.ascent,
};

/** Converte percorsi in FeatureCollection per mappa esplorabile. */
export function routesToExploreGeoJson(routes: UserRouteRow[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];

  for (const route of routes) {
    let geojson: GeoJSON.GeoJSON;
    try {
      geojson = JSON.parse(route.geojson) as GeoJSON.GeoJSON;
    } catch {
      continue;
    }

    if (route.activity === "ski") {
      const { ascentCoords, descentCoords } = parseSkiGeoJson(geojson);
      if (ascentCoords && ascentCoords.length >= 2) {
        features.push({
          type: "Feature",
          properties: {
            routeId: route.id,
            name: route.name,
            activity: route.activity,
            mode: "ascent",
            owner: route.owner,
            color: SKI_TRACK_COLORS.ascent,
            dimmed: false,
          },
          geometry: { type: "LineString", coordinates: ascentCoords },
        });
      }
      if (descentCoords && descentCoords.length >= 2) {
        features.push({
          type: "Feature",
          properties: {
            routeId: route.id,
            name: route.name,
            activity: route.activity,
            mode: "descent",
            owner: route.owner,
            color: SKI_TRACK_COLORS.descent,
            dimmed: false,
          },
          geometry: { type: "LineString", coordinates: descentCoords },
        });
      }
      if (!ascentCoords && !descentCoords && geojson.type === "Feature" && geojson.geometry?.type === "LineString") {
        const coords = geojson.geometry.coordinates as [number, number][];
        if (coords.length >= 2) {
          features.push(lineFeature(route, coords, "ascent"));
        }
      }
    } else if (geojson.type === "Feature" && geojson.geometry?.type === "LineString") {
      const coords = geojson.geometry.coordinates as [number, number][];
      if (coords.length >= 2) {
        features.push(lineFeature(route, coords, route.activity));
      }
    }
  }

  return { type: "FeatureCollection", features };
}

function lineFeature(
  route: UserRouteRow,
  coords: [number, number][],
  mode: string,
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {
      routeId: route.id,
      name: route.name,
      activity: route.activity,
      mode,
      owner: route.owner,
      color: ACTIVITY_COLORS[route.activity],
      dimmed: false,
    },
    geometry: { type: "LineString", coordinates: coords },
  };
}

export function routeEndpoints(geojson: GeoJSON.GeoJSON): {
  start: [number, number] | null;
  end: [number, number] | null;
} {
  if (geojson.type === "Feature" && geojson.geometry?.type === "LineString") {
    const coords = geojson.geometry.coordinates as [number, number][];
    if (coords.length >= 2) {
      return { start: coords[0], end: coords[coords.length - 1] };
    }
  }
  const ep = routeEndpointsFromSkiGeojson(geojson);
  return { start: ep?.start ?? null, end: ep?.end ?? null };
}

export function applyExploreSelection(
  fc: GeoJSON.FeatureCollection,
  selectedRouteId: string | null,
): GeoJSON.FeatureCollection {
  if (!selectedRouteId) {
    return {
      type: "FeatureCollection",
      features: fc.features.map((f) => ({
        ...f,
        properties: { ...f.properties, dimmed: false },
      })),
    };
  }
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        dimmed: (f.properties as { routeId?: string }).routeId !== selectedRouteId,
      },
    })),
  };
}

/** Centro e zoom approssimativi per un percorso nella FeatureCollection. */
export function exploreRouteView(
  fc: GeoJSON.FeatureCollection,
  routeId: string,
): { lng: number; lat: number; zoom: number } | null {
  const feats = fc.features.filter(
    (f) => (f.properties as { routeId?: string }).routeId === routeId,
  );
  if (feats.length === 0) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const f of feats) {
    if (f.geometry?.type !== "LineString") continue;
    for (const c of f.geometry.coordinates as [number, number][]) {
      minLng = Math.min(minLng, c[0]);
      maxLng = Math.max(maxLng, c[0]);
      minLat = Math.min(minLat, c[1]);
      maxLat = Math.max(maxLat, c[1]);
    }
  }
  if (!Number.isFinite(minLng)) return null;
  const lng = (minLng + maxLng) / 2;
  const lat = (minLat + maxLat) / 2;
  const span = Math.max(maxLng - minLng, maxLat - minLat);
  const zoom = span > 0.5 ? 10 : span > 0.15 ? 12 : span > 0.05 ? 13 : 14;
  return { lng, lat, zoom };
}
