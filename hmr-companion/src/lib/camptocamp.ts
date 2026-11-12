/**
 * Client API camptocamp.org v6 — scialpinismo.
 * Bbox in EPSG:3857 (Web Mercator), come richiesto dall'API.
 */

const C2C_BASE = "https://api.camptocamp.org";
const USER_AGENT = "hmr-companion/0.1 (POC; contact via repo)";

export type C2cBbox3857 = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type C2cRouteSummary = {
  document_id: number;
  locales: { lang: string; title: string; summary?: string | null }[];
  geometry?: {
    geom?: string;
    geom_detail?: string | null;
    has_geom_detail?: boolean;
  };
  height_diff_up?: number;
  height_diff_down?: number;
  elevation_max?: number;
  elevation_min?: number;
  ski_rating?: string;
  ski_exposition?: string;
  labande_global_rating?: string;
  labande_ski_rating?: string;
  orientations?: string[];
};

export type C2cLocale = {
  lang: string;
  title: string;
  title_prefix?: string | null;
  summary?: string | null;
  description?: string | null;
  remarks?: string | null;
  gear?: string | null;
  slope?: string | null;
};

export type C2cAssociatedWaypoint = {
  document_id: number;
  waypoint_type?: string;
  elevation?: number | null;
  locales?: { lang: string; title: string }[];
  geometry?: { geom?: string | null };
};

export type C2cRouteDetail = C2cRouteSummary & {
  locales: C2cLocale[];
  /** Durata in GIORNI (stringhe «1», «2»…), non in ore. */
  durations?: string[] | null;
  calculated_duration?: number | null;
  route_types?: string[] | null;
  lift_access?: boolean | null;
  glacier_gear?: string | null;
  associations?: { waypoints?: C2cAssociatedWaypoint[] };
  areas?: { area_type?: string; locales?: { lang: string; title: string }[] }[];
};

/** Testo di un campo nella prima lingua disponibile secondo la preferenza (default it → en → fr). */
export function pickLocaleText(
  locales: C2cLocale[],
  field: "summary" | "description" | "remarks" | "gear",
  prefer: string[] = ["it", "en", "fr"],
): { text: string; lang: string } | null {
  const order = [...prefer, ...locales.map((l) => l.lang).filter((l) => !prefer.includes(l))];
  for (const lang of order) {
    const v = locales.find((l) => l.lang === lang)?.[field];
    if (typeof v === "string" && v.trim()) return { text: v.trim(), lang };
  }
  return null;
}

function parseGeom(raw: string | undefined | null): GeoJSON.Geometry | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GeoJSON.Geometry;
  } catch {
    return null;
  }
}

/** Web Mercator (EPSG:3857) → WGS84 [lng, lat]. */
export function mercator3857ToWgs84(x: number, y: number): [number, number] {
  const lng = (x / 6378137) * (180 / Math.PI);
  const lat = (Math.atan(Math.sinh(y / 6378137)) * 180) / Math.PI;
  return [lng, lat];
}

function flattenCoords(
  geom: GeoJSON.Geometry,
): [number, number][] {
  const out: [number, number][] = [];
  const push = (c: number[]) => {
    if (c.length >= 2) out.push(mercator3857ToWgs84(c[0], c[1]));
  };
  if (geom.type === "LineString") {
    for (const c of geom.coordinates) push(c as number[]);
  } else if (geom.type === "MultiLineString") {
    for (const line of geom.coordinates) {
      for (const c of line) push(c as number[]);
    }
  } else if (geom.type === "Point") {
    push(geom.coordinates as number[]);
  }
  return out;
}

export function routeLineWgs84(detail: C2cRouteDetail): [number, number][] | null {
  const geomDetail = parseGeom(detail.geometry?.geom_detail);
  if (geomDetail && (geomDetail.type === "LineString" || geomDetail.type === "MultiLineString")) {
    const coords = flattenCoords(geomDetail);
    return coords.length >= 2 ? coords : null;
  }
  const geom = parseGeom(detail.geometry?.geom);
  if (geom && (geom.type === "LineString" || geom.type === "MultiLineString")) {
    const coords = flattenCoords(geom);
    return coords.length >= 2 ? coords : null;
  }
  return null;
}

export function pickLocaleTitle(
  locales: { lang: string; title: string; title_prefix?: string | null }[],
  prefer: string[] = ["it", "fr", "de", "en"],
): string {
  for (const lang of prefer) {
    const loc = locales.find((l) => l.lang === lang);
    if (loc?.title) {
      const prefix = loc.title_prefix?.trim();
      return prefix ? `${prefix} — ${loc.title}` : loc.title;
    }
  }
  return locales[0]?.title ?? "Itinerario scialpinismo";
}

export function bboxToParam(b: C2cBbox3857): string {
  return `${b.west},${b.south},${b.east},${b.north}`;
}

async function c2cFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${C2C_BASE}${path}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`camptocamp ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Attività camptocamp → sport dell'app. */
export const C2C_ACTIVITY_MAP = {
  hiking: "hike",
  mountain_biking: "mtb",
  via_ferrata: "ferrata",
  snowshoeing: "snowshoe",
  mountain_climbing: "alpinism",
} as const;

export type C2cActivity = keyof typeof C2C_ACTIVITY_MAP | "skitouring";

export async function searchRoutes(
  act: C2cActivity,
  bbox: C2cBbox3857,
  opts?: { limit?: number; offset?: number },
): Promise<{ documents: (C2cRouteSummary & Record<string, unknown>)[]; total: number }> {
  const q = new URLSearchParams({
    act,
    bbox: bboxToParam(bbox),
    limit: String(opts?.limit ?? 100),
    offset: String(opts?.offset ?? 0),
  });
  return c2cFetch(`/routes?${q}`);
}

export async function searchSkiRoutes(
  bbox: C2cBbox3857,
  opts?: { limit?: number; offset?: number },
): Promise<{ documents: C2cRouteSummary[]; total: number }> {
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;
  const q = new URLSearchParams({
    act: "skitouring",
    bbox: bboxToParam(bbox),
    limit: String(limit),
    offset: String(offset),
  });
  return c2cFetch(`/routes?${q}`);
}

export async function getRoute(id: number): Promise<C2cRouteDetail> {
  return c2cFetch(`/routes/${id}`);
}

/** Bbox Lombardia + Alpi occidentali/centrali (EPSG:3857). */
export const ALPS_IMPORT_BBOXES: C2cBbox3857[] = [
  { west: 650_000, south: 5_700_000, east: 1_150_000, north: 5_950_000 },
  { west: 900_000, south: 5_750_000, east: 1_200_000, north: 6_000_000 },
];
