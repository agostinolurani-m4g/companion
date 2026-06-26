/**
 * Query Overpass OpenStreetMap per HMR Companion.
 * Tutte le categorie sono pensate come "snapshot in corridoio" sulla traccia,
 * non dinamiche a runtime.
 */

import type { Position } from "geojson";
import type { PoiCategory } from "./db";

/** Mirror pubblici; ordine = priorità. Kumi/FR spesso più stabili del solo cluster DE. */
const DEFAULT_INTERPRETERS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];

function activeInterpreters(): string[] {
  const override = process.env.HMR_OVERPASS_MIRROR?.trim();
  if (override) {
    return override
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return DEFAULT_INTERPRETERS.slice();
}

const DEFAULT_UA = "hmr-companion/0.1 (local)";

export type OsmNode = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
};

let mirrorOffset = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mirrorSwitchDelayMs(): number {
  const raw = process.env.HMR_OVERPASS_MIRROR_PAUSE_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 0 && n <= 10_000) return n;
  return 800;
}

function isLikelyNetworkError(message: string): boolean {
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket|network|timed out|abort/i.test(
    message
  );
}

function overpassTimeoutMs(): number {
  const raw = process.env.HMR_OVERPASS_TIMEOUT_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 10_000 && n <= 180_000) return n;
  return 55_000;
}

export class OverpassError extends Error {
  status: number;
  transient: boolean;
  /** Secondi consigliati di attesa (da header Retry-After o body). */
  retryAfterSec?: number;
  constructor(message: string, status: number, transient: boolean, retryAfterSec?: number) {
    super(message);
    this.name = "OverpassError";
    this.status = status;
    this.transient = transient;
    this.retryAfterSec = retryAfterSec;
  }
}

function parseRetryAfter(res: Response, body: string | null): number | undefined {
  const h = res.headers.get("retry-after") || res.headers.get("Retry-After");
  if (h) {
    const n = parseInt(h, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 600) return n;
  }
  if (body) {
    const m = /(?:slot|retry).*?(\d+)\s*second/i.exec(body);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n <= 600) return n;
    }
  }
  return undefined;
}

/** Elementi Overpass grezzi (nodes, ways con geometry, …). */
export async function fetchOverpassRawElements(query: string): Promise<unknown[]> {
  const ua = process.env.HMR_OVERPASS_UA?.trim() || DEFAULT_UA;
  const formBody = `data=${encodeURIComponent(query)}`;
  const mirrors = activeInterpreters();
  const failures: string[] = [];
  const startIdx = mirrorOffset % mirrors.length;
  for (let k = 0; k < mirrors.length; k++) {
    const url = mirrors[(startIdx + k) % mirrors.length];
    if (k > 0) await sleep(mirrorSwitchDelayMs());
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": ua,
          Accept: "application/json",
        },
        body: formBody,
        signal: AbortSignal.timeout(overpassTimeoutMs()),
      });
      if (!res.ok) {
        const transient = [408, 429, 502, 503, 504].includes(res.status);
        let retryAfter: number | undefined;
        if (res.status === 429) {
          let body: string | null = null;
          try {
            body = await res.text();
          } catch {
            body = null;
          }
          retryAfter = parseRetryAfter(res, body);
        }
        const httpErr = new OverpassError(
          `Overpass HTTP ${res.status} (${url})${retryAfter != null ? ` retry-after ${retryAfter}s` : ""}`,
          res.status,
          transient,
          retryAfter
        );
        failures.push(httpErr.message);
        if (transient) continue;
        throw httpErr;
      }
      const text = await res.text();
      const looksJson = text.trimStart().startsWith("{");
      if (!looksJson) {
        const busy = /timed? out|too busy|runtime error|osm3s/i.test(text);
        const nonJsonErr = new OverpassError(
          `Overpass risposta non-JSON da ${url}${busy ? " (server busy)" : ""}`,
          busy ? 503 : 502,
          true
        );
        failures.push(nonJsonErr.message);
        continue;
      }
      try {
        const j = JSON.parse(text) as { elements?: unknown[]; remark?: string };
        if (j.remark && /timed? out|too busy|runtime error/i.test(j.remark)) {
          const remarkErr = new OverpassError(
            `Overpass remark da ${url}: ${j.remark}`,
            503,
            true
          );
          failures.push(remarkErr.message);
          continue;
        }
        mirrorOffset = (startIdx + k) % mirrors.length;
        return j.elements ?? [];
      } catch (e) {
        const jsonErr = new OverpassError(
          `Overpass JSON invalido (${url}): ${(e as Error).message}`,
          502,
          true
        );
        failures.push(jsonErr.message);
        continue;
      }
    } catch (e) {
      if (e instanceof OverpassError) {
        failures.push(e.message);
        if (!e.transient) throw e;
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        const net = isLikelyNetworkError(msg);
        failures.push(`Overpass fetch error (${url}): ${msg}`);
        if (!net) throw new OverpassError(failures[failures.length - 1]!, 0, false);
      }
    }
  }
  mirrorOffset = (mirrorOffset + 1) % mirrors.length;
  const hint =
    "Prova più tardi o imposta HMR_OVERPASS_MIRROR in .env.local (es. https://overpass.kumi.systems/api/interpreter).";
  const detail = failures.length > 0 ? failures.join(" · ") : "nessun dettaglio";
  throw new OverpassError(`Overpass: tutti i mirror hanno fallito. ${hint} Dettaglio: ${detail}`, 0, true);
}

type RawOsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  center?: { lat: number; lon: number };
};

/**
 * Rende elementi usabili come punti: node ha lat/lon; way/relation hanno
 * `center` solo con `out center` in Overpass (edifici ristoranti, hotel, …).
 */
export function toOsmNode(el: unknown): OsmNode | null {
  if (!el || typeof el !== "object") return null;
  const o = el as RawOsmElement;
  if (o.type === "node" && typeof o.lat === "number" && typeof o.lon === "number") {
    return { type: o.type, id: o.id, lat: o.lat, lon: o.lon, tags: o.tags };
  }
  if (
    (o.type === "way" || o.type === "relation") &&
    o.center &&
    typeof o.center.lat === "number" &&
    typeof o.center.lon === "number"
  ) {
    return { type: o.type, id: o.id, lat: o.center.lat, lon: o.center.lon, tags: o.tags };
  }
  return null;
}

async function fetchOverpass(query: string): Promise<OsmNode[]> {
  const raw = await fetchOverpassRawElements(query);
  const out: OsmNode[] = [];
  for (const e of raw) {
    const n = toOsmNode(e);
    if (n) out.push(n);
  }
  return out;
}

export type OsmWayGeom = {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

function isOsmWayGeom(el: unknown): el is OsmWayGeom {
  if (!el || typeof el !== "object") return false;
  const o = el as Record<string, unknown>;
  if (o.type !== "way" || typeof o.id !== "number") return false;
  if (!Array.isArray(o.geometry) || o.geometry.length < 2) return false;
  return true;
}

/** Ways OSM con geometria (out geom) in bbox — utile per classificare superficie lungo traccia. */
export async function fetchHighwayWaysGeomInBbox(bbox: Bbox): Promise<OsmWayGeom[]> {
  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:125];
(
  way["highway"](${s},${w},${n},${e});
);
out geom;`;
  const els = await fetchOverpassRawElements(q);
  return els.filter(isOsmWayGeom);
}

function corridorSection(
  samples: Position[],
  radiusM: number,
  lines: string[]
): string {
  const r = Math.max(80, Math.min(2500, Math.floor(radiusM)));
  const body: string[] = [];
  for (const c of samples) {
    const lat = c[1];
    const lon = c[0];
    for (const line of lines) {
      body.push(`  ${line}(around:${r},${lat},${lon});`);
    }
  }
  return `[out:json][timeout:40];\n(\n${body.join("\n")}\n);\nout body;`;
}

/** Bbox [s,w,n,e] per una query globale per categoria. */
export type Bbox = [number, number, number, number];

function bboxSection(bbox: Bbox, lines: string[]): string {
  const [s, w, n, e] = bbox;
  const bb = `${s},${w},${n},${e}`;
  const body = lines.map((l) => `  ${l}(${bb});`).join("\n");
  // `out center` fornisce il centroide per way/relation (ristoranti come edifici, ecc.)
  return `[out:json][timeout:120];\n(\n${body}\n);\nout center;`;
}

/* ---------------- Categorie ---------------- */

export type WaterSub = "drinking_water" | "fountain" | "water_tap" | "spring";

export type LodgingSub = "hotel" | "guest_house" | "hostel" | "motel" | "camp_site";

export type ShopSub = "supermarket" | "convenience" | "grocery" | "bakery" | "butcher";

export type FoodSub = "restaurant" | "cafe" | "fast_food" | "bar" | "pub";

export type HutSub = "alpine_hut" | "wilderness_hut" | "shelter";

export type HealthSub = "pharmacy" | "hospital" | "clinic" | "doctors";

export type UtilitySub = "atm" | "bus_stop" | "bus_station" | "fuel";

export async function fetchWaterAlongCorridor(
  samples: Position[],
  radiusM: number
): Promise<OsmNode[]> {
  const q = corridorSection(samples, radiusM, [
    `node["amenity"="drinking_water"]`,
    `node["amenity"="fountain"]`,
    `node["man_made"="water_tap"]`,
    `node["natural"="spring"]`,
  ]);
  return fetchOverpass(q);
}

export async function fetchHutAlongCorridor(
  samples: Position[],
  radiusM: number
): Promise<OsmNode[]> {
  const q = corridorSection(samples, radiusM, [
    `node["tourism"="alpine_hut"]`,
    `node["tourism"="wilderness_hut"]`,
    `node["amenity"="shelter"]`,
  ]);
  return fetchOverpass(q);
}

export async function fetchLodgingAlongCorridor(
  samples: Position[],
  radiusM: number
): Promise<OsmNode[]> {
  const q = corridorSection(samples, radiusM, [
    `node["tourism"="hotel"]`,
    `node["tourism"="guest_house"]`,
    `node["tourism"="hostel"]`,
    `node["tourism"="motel"]`,
    `node["tourism"="camp_site"]`,
  ]);
  return fetchOverpass(q);
}

export async function fetchShopsAlongCorridor(
  samples: Position[],
  radiusM: number
): Promise<OsmNode[]> {
  const q = corridorSection(samples, radiusM, [
    `node["shop"="supermarket"]`,
    `node["shop"="convenience"]`,
    `node["shop"="grocery"]`,
    `node["shop"="bakery"]`,
    `node["shop"="butcher"]`,
  ]);
  return fetchOverpass(q);
}

export async function fetchFoodAlongCorridor(
  samples: Position[],
  radiusM: number
): Promise<OsmNode[]> {
  const q = corridorSection(samples, radiusM, [
    `node["amenity"="restaurant"]`,
    `node["amenity"="cafe"]`,
    `node["amenity"="fast_food"]`,
    `node["amenity"="bar"]`,
    `node["amenity"="pub"]`,
  ]);
  return fetchOverpass(q);
}

export async function fetchHealthAlongCorridor(
  samples: Position[],
  radiusM: number
): Promise<OsmNode[]> {
  const q = corridorSection(samples, radiusM, [
    `node["amenity"="pharmacy"]`,
    `node["amenity"="hospital"]`,
    `node["amenity"="clinic"]`,
    `node["amenity"="doctors"]`,
  ]);
  return fetchOverpass(q);
}

export async function fetchUtilitiesAlongCorridor(
  samples: Position[],
  radiusM: number
): Promise<OsmNode[]> {
  const q = corridorSection(samples, radiusM, [
    `node["amenity"="atm"]`,
    `node["highway"="bus_stop"]`,
    `node["amenity"="bus_station"]`,
    `node["amenity"="fuel"]`,
  ]);
  return fetchOverpass(q);
}

/* ---------------- Bbox variants (meno round-trip) ---------------- */

/** node + way: in OSM molti POI sono aree (edifici); i soli node perdevano la maggior parte dei ristoranti, negozi, … */
const BBOX_LINES = {
  water: [
    `node["amenity"="drinking_water"]`,
    `way["amenity"="drinking_water"]`,
    `node["amenity"="fountain"]`,
    `way["amenity"="fountain"]`,
    `node["man_made"="water_tap"]`,
    `way["man_made"="water_tap"]`,
    `node["natural"="spring"]`,
    `way["natural"="spring"]`,
  ],
  hut: [
    `node["tourism"="alpine_hut"]`,
    `way["tourism"="alpine_hut"]`,
    `node["tourism"="wilderness_hut"]`,
    `way["tourism"="wilderness_hut"]`,
    `node["amenity"="shelter"]`,
    `way["amenity"="shelter"]`,
  ],
  lodging: [
    `node["tourism"="hotel"]`,
    `way["tourism"="hotel"]`,
    `node["tourism"="guest_house"]`,
    `way["tourism"="guest_house"]`,
    `node["tourism"="hostel"]`,
    `way["tourism"="hostel"]`,
    `node["tourism"="motel"]`,
    `way["tourism"="motel"]`,
  ],
  campsite: [
    `node["tourism"="camp_site"]`,
    `way["tourism"="camp_site"]`,
  ],
  shop: [
    `node["shop"="supermarket"]`,
    `way["shop"="supermarket"]`,
    `node["shop"="convenience"]`,
    `way["shop"="convenience"]`,
    `node["shop"="grocery"]`,
    `way["shop"="grocery"]`,
    `node["shop"="bakery"]`,
    `way["shop"="bakery"]`,
    `node["shop"="butcher"]`,
    `way["shop"="butcher"]`,
  ],
  food: [
    `node["amenity"="restaurant"]`,
    `way["amenity"="restaurant"]`,
    `node["amenity"="cafe"]`,
    `way["amenity"="cafe"]`,
    `node["amenity"="fast_food"]`,
    `way["amenity"="fast_food"]`,
    `node["amenity"="bar"]`,
    `way["amenity"="bar"]`,
    `node["amenity"="pub"]`,
    `way["amenity"="pub"]`,
  ],
  health: [
    `node["amenity"="pharmacy"]`,
    `way["amenity"="pharmacy"]`,
    `node["amenity"="hospital"]`,
    `way["amenity"="hospital"]`,
    `node["amenity"="clinic"]`,
    `way["amenity"="clinic"]`,
    `node["amenity"="doctors"]`,
    `way["amenity"="doctors"]`,
  ],
  utilities: [
    `node["amenity"="atm"]`,
    `way["amenity"="atm"]`,
    `node["highway"="bus_stop"]`,
    `node["amenity"="bus_station"]`,
    `way["amenity"="bus_station"]`,
    `node["amenity"="fuel"]`,
    `way["amenity"="fuel"]`,
  ],
} as const;

export type BboxCategoryKey = keyof typeof BBOX_LINES;

/** Tutte le clausole node/way usate nello snapshot (deduplicate). */
export function allPoiOverpassLineStrings(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of Object.keys(BBOX_LINES) as BboxCategoryKey[]) {
    for (const line of BBOX_LINES[key]) {
      if (!seen.has(line)) {
        seen.add(line);
        out.push(line);
      }
    }
  }
  return out;
}

/** Mappa categorie app → gruppi query Overpass (vedi BBOX_LINES). */
export function bboxKeysForPoiCategories(categories: PoiCategory[]): BboxCategoryKey[] {
  const keys = new Set<BboxCategoryKey>();
  for (const c of categories) {
    switch (c) {
      case "water":
        keys.add("water");
        break;
      case "hut":
        keys.add("hut");
        break;
      case "lodging":
        keys.add("lodging");
        break;
      case "campsite":
        keys.add("campsite");
        break;
      case "shop":
        keys.add("shop");
        break;
      case "restaurant":
        keys.add("food");
        break;
      case "pharmacy":
        keys.add("health");
        break;
      case "atm":
      case "bus":
        keys.add("utilities");
        break;
      default:
        break;
    }
  }
  return Array.from(keys);
}

function overpassLinesForBboxKeys(keys: BboxCategoryKey[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    for (const line of BBOX_LINES[key]) {
      if (!seen.has(line)) {
        seen.add(line);
        out.push(line);
      }
    }
  }
  return out;
}

/** Raggio harvest su mappa: clamp per non stressare Overpass (max 5 km). */
export function clampPoiHarvestRadiusM(radiusM: number): number {
  return Math.max(80, Math.min(5000, Math.round(radiusM)));
}

export type ViewBbox = { south: number; west: number; north: number; east: number };

/** Lato max bbox per harvest POI (~22 km) — evita timeout Overpass. */
const MAX_POI_BBOX_SPAN_DEG = 0.2;

export function clampPoiHarvestBbox(
  b: ViewBbox
): { ok: true; bbox: Bbox } | { ok: false; error: string } {
  const { south, west, north, east } = b;
  if (![south, west, north, east].every(Number.isFinite)) {
    return { ok: false, error: "Area mappa non valida" };
  }
  const latSpan = north - south;
  const lngSpan = east - west;
  if (latSpan <= 0 || lngSpan <= 0) {
    return { ok: false, error: "Area mappa non valida" };
  }
  if (latSpan > MAX_POI_BBOX_SPAN_DEG || lngSpan > MAX_POI_BBOX_SPAN_DEG) {
    const km = Math.round(MAX_POI_BBOX_SPAN_DEG * 111);
    return { ok: false, error: `Area troppo ampia: ingrandisci la mappa (max ~${km} km)` };
  }
  return { ok: true, bbox: [south, west, north, east] };
}

/**
 * Interroga Overpass in un cerchio attorno a un punto.
 * `bboxKeys`: null o [] = tutte le categorie snapshot; altrimenti solo i gruppi indicati.
 */
export async function fetchPoiTypesAround(
  lat: number,
  lon: number,
  radiusM: number,
  bboxKeys: BboxCategoryKey[] | null
): Promise<OsmNode[]> {
  const r = clampPoiHarvestRadiusM(radiusM);
  const keys =
    bboxKeys && bboxKeys.length > 0
      ? bboxKeys
      : (Object.keys(BBOX_LINES) as BboxCategoryKey[]);
  const lines = overpassLinesForBboxKeys(keys);
  const body = lines.map((l) => `  ${l}(around:${r},${lat},${lon});`).join("\n");
  const q = `[out:json][timeout:90];\n(\n${body}\n);\nout center;`;
  return fetchOverpass(q);
}

/**
 * Interroga Overpass nel rettangolo visibile sulla mappa.
 */
export async function fetchPoiTypesInBbox(
  bbox: Bbox,
  bboxKeys: BboxCategoryKey[] | null
): Promise<OsmNode[]> {
  const keys =
    bboxKeys && bboxKeys.length > 0
      ? bboxKeys
      : (Object.keys(BBOX_LINES) as BboxCategoryKey[]);
  const lines = overpassLinesForBboxKeys(keys);
  const q = bboxSection(bbox, lines);
  return fetchOverpass(q);
}

/**
 * Interroga Overpass in un cerchio (come `around:`) attorno a un punto sulla mappa:
 * utile per “cerca POI qui” con raggio piccolo (paese, incrocio).
 * Ordine Overpass: around:metri, lat, lon.
 */
export async function fetchAllPoiTypesAround(
  lat: number,
  lon: number,
  radiusM: number
): Promise<OsmNode[]> {
  return fetchPoiTypesAround(lat, lon, radiusM, null);
}

export async function fetchCategoryInBbox(
  key: BboxCategoryKey,
  bbox: Bbox
): Promise<OsmNode[]> {
  const q = bboxSection(bbox, BBOX_LINES[key] as unknown as string[]);
  return fetchOverpass(q);
}

/* ---------------- Helpers tag → fields ---------------- */

export function osmImageFromTags(tags: Record<string, string>): string | null {
  const direct = tags.image?.trim();
  if (direct && /^https?:\/\//i.test(direct)) return direct;
  const wm = tags["image:wikimedia_commons"]?.trim() || tags["wikimedia_commons"]?.trim();
  if (wm) {
    const name = wm.replace(/^File:/i, "");
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}`;
  }
  return null;
}

export function osmDescriptionFromTags(tags: Record<string, string>): string | null {
  const d =
    tags.description?.trim() ||
    tags["description:en"]?.trim() ||
    tags["description:el"]?.trim() ||
    tags["description:it"]?.trim() ||
    tags.note?.trim() ||
    tags.cuisine?.trim();
  return d || null;
}

export function osmPhoneFromTags(tags: Record<string, string>): string | null {
  const p = tags.phone?.trim() || tags["contact:phone"]?.trim() || tags.mobile?.trim();
  return p || null;
}

export function osmWebsiteFromTags(tags: Record<string, string>): string | null {
  const w = tags.website?.trim() || tags["contact:website"]?.trim() || tags.url?.trim();
  if (!w) return null;
  if (/^https?:\/\//i.test(w)) return w;
  return `https://${w}`;
}

export function osmOpeningHoursFromTags(tags: Record<string, string>): string | null {
  const o = tags.opening_hours?.trim();
  return o || null;
}

/* ---------------- Mapping OSM → PoiCategory ---------------- */

export type ClassifiedOsm = {
  category: PoiCategory;
  sub_kind: string;
};

export function classifyOsm(tags: Record<string, string>): ClassifiedOsm | null {
  if (tags.amenity === "drinking_water") return { category: "water", sub_kind: "drinking_water" };
  if (tags.amenity === "fountain") return { category: "water", sub_kind: "fountain" };
  if (tags.man_made === "water_tap") return { category: "water", sub_kind: "water_tap" };
  if (tags.natural === "spring") return { category: "water", sub_kind: "spring" };

  if (tags.tourism === "alpine_hut") return { category: "hut", sub_kind: "alpine_hut" };
  if (tags.tourism === "wilderness_hut") return { category: "hut", sub_kind: "wilderness_hut" };
  if (tags.amenity === "shelter") return { category: "hut", sub_kind: "shelter" };

  if (tags.tourism === "hotel") return { category: "lodging", sub_kind: "hotel" };
  if (tags.tourism === "guest_house") return { category: "lodging", sub_kind: "guest_house" };
  if (tags.tourism === "hostel") return { category: "lodging", sub_kind: "hostel" };
  if (tags.tourism === "motel") return { category: "lodging", sub_kind: "motel" };
  if (tags.tourism === "camp_site") return { category: "campsite", sub_kind: "camp_site" };

  if (tags.shop === "supermarket") return { category: "shop", sub_kind: "supermarket" };
  if (tags.shop === "convenience") return { category: "shop", sub_kind: "convenience" };
  if (tags.shop === "grocery") return { category: "shop", sub_kind: "grocery" };
  if (tags.shop === "bakery") return { category: "shop", sub_kind: "bakery" };
  if (tags.shop === "butcher") return { category: "shop", sub_kind: "butcher" };

  if (tags.amenity === "restaurant") return { category: "restaurant", sub_kind: "restaurant" };
  if (tags.amenity === "cafe") return { category: "restaurant", sub_kind: "cafe" };
  if (tags.amenity === "fast_food") return { category: "restaurant", sub_kind: "fast_food" };
  if (tags.amenity === "bar") return { category: "restaurant", sub_kind: "bar" };
  if (tags.amenity === "pub") return { category: "restaurant", sub_kind: "pub" };

  if (tags.amenity === "pharmacy") return { category: "pharmacy", sub_kind: "pharmacy" };
  if (tags.amenity === "hospital") return { category: "pharmacy", sub_kind: "hospital" };
  if (tags.amenity === "clinic") return { category: "pharmacy", sub_kind: "clinic" };
  if (tags.amenity === "doctors") return { category: "pharmacy", sub_kind: "doctors" };

  if (tags.amenity === "atm") return { category: "atm", sub_kind: "atm" };
  if (tags.amenity === "fuel") return { category: "atm", sub_kind: "fuel" };

  if (tags.highway === "bus_stop") return { category: "bus", sub_kind: "bus_stop" };
  if (tags.amenity === "bus_station") return { category: "bus", sub_kind: "bus_station" };

  return null;
}
