import { lineLengthKm } from "@/lib/osrm-route";
export const SLOPE_TILES_URL =
  process.env.NEXT_PUBLIC_SLOPE_TILES_URL?.trim() ||
  "/api/v2/ski/slope-tiles/{z}/{x}/{y}";

/** @deprecated Valanghe ora via GeoJSON /api/v2/ski/avalanche */
export const AVALANCHE_TILES_URL =
  process.env.NEXT_PUBLIC_AVALANCHE_TILES_URL?.trim() || "";

/** Legenda OpenSlopeMap overlay LR (Alpi) — soglie pendenza in gradi. */
export const SLOPE_LEGEND = [
  { label: "≤30°", color: "transparent" },
  { label: ">30°", color: "#ffff00" },
  { label: ">35°", color: "#ffd700" },
  { label: ">40°", color: "#ffa500" },
  { label: ">45°", color: "#ff8c00" },
  { label: ">50°", color: "#ff4500" },
  { label: ">55°", color: "#ff0000" },
  { label: ">60°", color: "#cc0000" },
  { label: ">70°", color: "#800000" },
] as const;

/** Scala europea pericolo valanghe (EAWS). */
export const AVALANCHE_LEGEND = [
  { level: 1, label: "1 — Debole", color: "#22c55e" },
  { level: 2, label: "2 — Moderato", color: "#eab308" },
  { level: 3, label: "3 — Marcato", color: "#f97316" },
  { level: 4, label: "4 — Forte", color: "#ef4444" },
  { level: 5, label: "5 — Molto forte", color: "#1e1b4b" },
] as const;

export const SKI_TRACK_COLORS = {
  ascent: "#059669",
  descent: "#dc2626",
} as const;

/** Opacità fissa overlay pendenza (~1/3 del valore precedente). */
export const SKI_SLOPE_DEFAULT_OPACITY = 0.65 / 3;

/** Opacità fissa bollettino valanghe (~1/3 del valore precedente). */
export const SKI_AVALANCHE_DEFAULT_OPACITY = 0.45 / 3;

export type SkiTrackMode = "ascent" | "descent";

export type SkiWaypointsPayload = {
  ascent: [number, number][];
  descent: [number, number][];
};

export function buildSkiGeoJson(
  ascentCoords: [number, number][] | null,
  descentCoords: [number, number][] | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  if (ascentCoords && ascentCoords.length >= 2) {
    features.push({
      type: "Feature",
      properties: { mode: "ascent" },
      geometry: { type: "LineString", coordinates: ascentCoords },
    });
  }
  if (descentCoords && descentCoords.length >= 2) {
    features.push({
      type: "Feature",
      properties: { mode: "descent" },
      geometry: { type: "LineString", coordinates: descentCoords },
    });
  }
  return { type: "FeatureCollection", features };
}

export function parseSkiGeoJson(geojson: GeoJSON.GeoJSON): {
  ascentCoords: [number, number][] | null;
  descentCoords: [number, number][] | null;
} {
  if (geojson.type === "FeatureCollection") {
    let ascentCoords: [number, number][] | null = null;
    let descentCoords: [number, number][] | null = null;
    for (const f of geojson.features) {
      if (f.geometry?.type !== "LineString") continue;
      const mode = (f.properties as { mode?: string } | null)?.mode;
      const coords = f.geometry.coordinates as [number, number][];
      if (mode === "ascent") ascentCoords = coords;
      else if (mode === "descent") descentCoords = coords;
    }
    return { ascentCoords, descentCoords };
  }
  if (geojson.type === "Feature" && geojson.geometry?.type === "LineString") {
    const mode = (geojson.properties as { mode?: string } | null)?.mode;
    const coords = geojson.geometry.coordinates as [number, number][];
    if (mode === "descent") return { ascentCoords: null, descentCoords: coords };
    return { ascentCoords: coords, descentCoords: null };
  }
  return { ascentCoords: null, descentCoords: null };
}

export function parseSkiWaypoints(raw: unknown): SkiWaypointsPayload {
  if (Array.isArray(raw)) {
    return { ascent: raw as [number, number][], descent: [] };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Partial<SkiWaypointsPayload>;
    return {
      ascent: Array.isArray(o.ascent) ? o.ascent : [],
      descent: Array.isArray(o.descent) ? o.descent : [],
    };
  }
  return { ascent: [], descent: [] };
}

/** Linea retta tra waypoint (discesa libera). */
export function freeDrawCoords(waypoints: { lng: number; lat: number }[]): [number, number][] {
  if (waypoints.length < 2) return [];
  return waypoints.map((w) => [w.lng, w.lat] as [number, number]);
}

export type RouteEndpoints = {
  start: [number, number];
  end: [number, number];
};

export const ROUTE_MARKER_COLORS = {
  start: "#22c55e",
  summit: "#eab308",
  end: "#ef4444",
} as const;

/** Waypoint salvati come traccia densa (import GPX/camptocamp legacy). */
export const DENSE_SKI_WAYPOINT_THRESHOLD = 15;

export function isDenseSkiWaypoints(waypoints: [number, number][]): boolean {
  return waypoints.length > DENSE_SKI_WAYPOINT_THRESHOLD;
}

/** Waypoint legacy = copia della traccia (import GPX/camptocamp vecchi). */
export function shouldStripSkiWaypoints(
  waypoints: [number, number][],
  trackCoords: [number, number][] | null,
): boolean {
  if (isDenseSkiWaypoints(waypoints)) return true;
  if (!trackCoords || trackCoords.length < 3 || waypoints.length < 3) return false;
  return waypoints.length >= Math.floor(trackCoords.length * 0.4);
}

/** Punto lungo la linea a frazione di distanza cumulata (0 = inizio, 1 = fine). */
export function pointAlongTrackAtFraction(
  coords: [number, number][],
  fraction: number,
): [number, number] {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1 || fraction <= 0) return coords[0];
  if (fraction >= 1) return coords[coords.length - 1];

  const cumKm: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cumKm.push(cumKm[i - 1] + lineLengthKm([coords[i - 1], coords[i]]));
  }
  const total = cumKm[cumKm.length - 1];
  if (total <= 0) return coords[coords.length - 1];
  const target = total * fraction;

  for (let i = 1; i < cumKm.length; i++) {
    if (cumKm[i] >= target) {
      const segLen = cumKm[i] - cumKm[i - 1];
      const t = segLen > 0 ? (target - cumKm[i - 1]) / segLen : 0;
      return [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
      ];
    }
  }
  return coords[coords.length - 1];
}

/**
 * Vetta su traccia unica (es. camptocamp): stima dal rapporto D+ / (D+ + D−).
 */
export function inferSummitOnSingleTrack(
  coords: [number, number][],
  elevGainM: number,
  elevLossM: number,
): [number, number] | null {
  if (coords.length < 2) return null;
  const total = elevGainM + elevLossM;
  if (total <= 0) return null;
  const frac = elevGainM / total;
  if (frac <= 0.03 || frac >= 0.97) return null;
  return pointAlongTrackAtFraction(coords, frac);
}

/** Partenza (inizio salita) e arrivo (fine discesa o salita). */
export function routeEndpointsFromSkiGeojson(geojson: GeoJSON.GeoJSON): RouteEndpoints | null {
  const { ascentCoords, descentCoords } = parseSkiGeoJson(geojson);
  let start: [number, number] | null = null;
  let end: [number, number] | null = null;

  if (ascentCoords && ascentCoords.length >= 1) {
    start = ascentCoords[0];
    end = ascentCoords[ascentCoords.length - 1];
  }
  if (descentCoords && descentCoords.length >= 1) {
    if (!start) start = descentCoords[0];
    end = descentCoords[descentCoords.length - 1];
  }

  if (!start || !end) {
    if (geojson.type === "Feature" && geojson.geometry?.type === "LineString") {
      const coords = geojson.geometry.coordinates as [number, number][];
      if (coords.length >= 2) {
        return { start: coords[0], end: coords[coords.length - 1] };
      }
    }
    return null;
  }
  return { start, end };
}

export function routeEndpointsFromCoords(
  ascentCoords: [number, number][] | null,
  descentCoords: [number, number][] | null,
): RouteEndpoints | null {
  return routeEndpointsFromSkiGeojson(
    buildSkiGeoJson(ascentCoords, descentCoords),
  );
}

function sameCoord(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

/** Marker partenza, vetta/inizio discesa, arrivo. */
export function buildRouteMarkersGeoJsonFromTracks(
  ascentCoords: [number, number][] | null,
  descentCoords: [number, number][] | null,
  opts?: { elevGainM?: number; elevLossM?: number },
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];

  const start = ascentCoords?.[0] ?? descentCoords?.[0] ?? null;
  const end =
    (descentCoords && descentCoords.length > 0
      ? descentCoords[descentCoords.length - 1]
      : null) ??
    (ascentCoords && ascentCoords.length > 0
      ? ascentCoords[ascentCoords.length - 1]
      : null);

  const hasSeparateDescent =
    ascentCoords &&
    ascentCoords.length >= 2 &&
    descentCoords &&
    descentCoords.length >= 2;

  let summit: [number, number] | null = null;
  if (hasSeparateDescent) {
    summit = ascentCoords[ascentCoords.length - 1];
  } else if (ascentCoords && ascentCoords.length >= 2) {
    summit = inferSummitOnSingleTrack(
      ascentCoords,
      opts?.elevGainM ?? 0,
      opts?.elevLossM ?? 0,
    );
  }

  if (start) {
    features.push({
      type: "Feature",
      properties: {
        kind: "start",
        label: "P",
        color: ROUTE_MARKER_COLORS.start,
        haloColor: ROUTE_MARKER_COLORS.start,
      },
      geometry: { type: "Point", coordinates: start },
    });
  }

  if (summit && (!start || !sameCoord(summit, start)) && (!end || !sameCoord(summit, end))) {
    features.push({
      type: "Feature",
      properties: {
        kind: "summit",
        label: "V",
        color: ROUTE_MARKER_COLORS.summit,
        haloColor: ROUTE_MARKER_COLORS.summit,
      },
      geometry: { type: "Point", coordinates: summit },
    });
  }

  if (end && (!start || !sameCoord(end, start))) {
    features.push({
      type: "Feature",
      properties: {
        kind: "end",
        label: "A",
        color: ROUTE_MARKER_COLORS.end,
        haloColor: ROUTE_MARKER_COLORS.end,
      },
      geometry: { type: "Point", coordinates: end },
    });
  }

  return { type: "FeatureCollection", features };
}

/** @deprecated Prefer buildRouteMarkersGeoJsonFromTracks */
export function buildRouteMarkersGeoJson(endpoints: RouteEndpoints | null): GeoJSON.FeatureCollection {
  if (!endpoints) return { type: "FeatureCollection", features: [] };
  return buildRouteMarkersGeoJsonFromTracks([endpoints.start], [endpoints.end]);
}

