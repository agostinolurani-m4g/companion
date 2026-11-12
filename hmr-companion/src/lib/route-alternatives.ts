import { geoCacheGet, geoCacheSet, type UserRouteActivity } from "@/lib/db";
import { activityToOrsProfile, buildOrsRequestBody, type RoutePreference } from "@/lib/openrouteservice-route";
import { lineLengthKm } from "@/lib/osrm-route";

/**
 * Varianti di percorso da ORS (`alternative_routes`, solo con 2 tappe), poi
 * ordinate dal chiamante in base alla popolarità della heatmap community.
 */
export async function fetchOrsAlternatives(
  coordinates: [number, number][],
  activity: UserRouteActivity,
  apiKey: string,
  preference: RoutePreference,
): Promise<{ coordinates: [number, number][]; length_km: number }[]> {
  if (coordinates.length !== 2) return [];
  const key = `v2route-alt:v1:${activity}:${preference}:${coordinates
    .map(([lng, lat]) => `${Math.round(lng * 1e5)}_${Math.round(lat * 1e5)}`)
    .join(";")}`;
  const cached = geoCacheGet(key) as { coordinates: [number, number][]; length_km: number }[] | null;
  if (Array.isArray(cached)) return cached;

  const profile = activityToOrsProfile(activity);
  const body = buildOrsRequestBody(coordinates, profile, preference, true);
  body.extra_info = [];
  body.alternative_routes = { target_count: 3, share_factor: 0.6, weight_factor: 1.6 };
  try {
    const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json", Accept: "application/geo+json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as GeoJSON.FeatureCollection;
    const out = (j.features ?? [])
      .filter((f) => f.geometry?.type === "LineString")
      .map((f) => {
        const coords = (f.geometry as GeoJSON.LineString).coordinates.map((c) => [c[0], c[1]] as [number, number]);
        return { coordinates: coords, length_km: lineLengthKm(coords) };
      })
      .filter((a) => a.coordinates.length >= 2);
    geoCacheSet(key, out);
    return out;
  } catch {
    return [];
  }
}
