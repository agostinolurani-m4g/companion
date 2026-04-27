/** Query Overpass API (OpenStreetMap) — fontane e punti acqua potabile. */

import type { Position } from "geojson";

/** Mirror pubblici (ordine: meno sovraccaricati prima). */
const OVERPASS_INTERPRETERS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

async function fetchOverpassInterpreter(formBody: string): Promise<Response> {
  let lastErr: Error | null = null;
  for (const url of OVERPASS_INTERPRETERS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody,
        signal: AbortSignal.timeout(55_000),
        next: { revalidate: 0 },
      });
      if (res.ok) return res;
      if (res.status === 504 || res.status === 502 || res.status === 503 || res.status === 429) {
        lastErr = new Error(`Overpass HTTP ${res.status} (${url})`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error("Overpass: tutti i mirror hanno fallito");
}

export type WaterPoi = {
  lat: number;
  lng: number;
  name: string | null;
  kind: string;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Bbox (south, west, north, east) con padding in gradi (~1 km max). */
export function padBbox(
  south: number,
  west: number,
  north: number,
  east: number,
  padDeg = 0.02
): { south: number; west: number; north: number; east: number } {
  return {
    south: clamp(south - padDeg, -85, 85),
    west: clamp(west - padDeg, -180, 180),
    north: clamp(north + padDeg, -85, 85),
    east: clamp(east + padDeg, -180, 180),
  };
}

/** Bbox da coordinate GeoJSON [lng, lat][]. */
export function bboxFromLngLatPositions(coords: [number, number][]): {
  south: number;
  west: number;
  north: number;
  east: number;
} | null {
  if (!coords.length) return null;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const c of coords) {
    const lng = c[0];
    const lat = c[1];
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  if (!Number.isFinite(south)) return null;
  return { south, west, north, east };
}

export async function fetchDrinkingWaterInBbox(
  south: number,
  west: number,
  north: number,
  east: number,
  limit = 40
): Promise<WaterPoi[]> {
  const q = `
[out:json][timeout:50];
(
  node["amenity"="drinking_water"](${south},${west},${north},${east});
  node["amenity"="fountain"](${south},${west},${north},${east});
  node["man_made"="water_tap"](${south},${west},${north},${east});
);
out body;
`;
  const formBody = `data=${encodeURIComponent(q)}`;
  const res = await fetchOverpassInterpreter(formBody);
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}`);
  }
  const j = (await res.json()) as {
    elements?: Array<{
      type: string;
      lat?: number;
      lon?: number;
      tags?: Record<string, string>;
    }>;
  };
  const out: WaterPoi[] = [];
  for (const el of j.elements ?? []) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    const tags = el.tags ?? {};
    const amenity = tags.amenity ?? tags.man_made ?? "water";
    out.push({
      lat: el.lat,
      lng: el.lon,
      name: tags.name ?? tags.ref ?? null,
      kind: amenity,
    });
  }
  return out.slice(0, limit);
}

function dedupeWaterPois(pois: WaterPoi[], limit: number): WaterPoi[] {
  const m = new Map<string, WaterPoi>();
  for (const p of pois) {
    const k = `${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`;
    if (!m.has(k)) m.set(k, p);
  }
  return [...m.values()].slice(0, limit);
}

/**
 * Fonti d’acqua in un corridoio lungo il percorso (`around` su punti campionati), non su tutta la bbox.
 */
export async function fetchDrinkingWaterAlongCorridor(
  samplePointsLngLat: Position[],
  radiusM: number,
  limit = 55
): Promise<WaterPoi[]> {
  if (samplePointsLngLat.length === 0) return [];
  const r = Math.max(80, Math.min(2000, Math.floor(radiusM)));
  const lines: string[] = [];
  for (const c of samplePointsLngLat) {
    const lat = c[1];
    const lon = c[0];
    lines.push(`  node["amenity"="drinking_water"](around:${r},${lat},${lon});`);
    lines.push(`  node["amenity"="fountain"](around:${r},${lat},${lon});`);
    lines.push(`  node["man_made"="water_tap"](around:${r},${lat},${lon});`);
  }
  const q = `
[out:json][timeout:55];
(
${lines.join("\n")}
);
out body;
`;
  const formBody = `data=${encodeURIComponent(q)}`;
  const res = await fetchOverpassInterpreter(formBody);
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}`);
  }
  const j = (await res.json()) as {
    elements?: Array<{
      type: string;
      lat?: number;
      lon?: number;
      tags?: Record<string, string>;
    }>;
  };
  const out: WaterPoi[] = [];
  for (const el of j.elements ?? []) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    const tags = el.tags ?? {};
    const amenity = tags.amenity ?? tags.man_made ?? "water";
    out.push({
      lat: el.lat,
      lng: el.lon,
      name: tags.name ?? tags.ref ?? null,
      kind: amenity,
    });
  }
  return dedupeWaterPois(out, limit);
}

export function bboxFromPositions(coords: Position[]): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const c of coords) {
    south = Math.min(south, c[1]);
    north = Math.max(north, c[1]);
    west = Math.min(west, c[0]);
    east = Math.max(east, c[0]);
  }
  if (!Number.isFinite(south)) {
    return { south: 0, west: 0, north: 0, east: 0 };
  }
  return { south, west, north, east };
}

export type TrailServicePoi = {
  lat: number;
  lng: number;
  name: string | null;
  /** Categoria grossolana per stile mappa. */
  kind: "hut" | "bivouac" | "shelter" | "restaurant";
  description?: string | null;
  phone?: string | null;
  website?: string | null;
  image_url?: string | null;
};

function trailServiceImageFromTags(tags: Record<string, string>): string | null {
  const direct = tags.image?.trim();
  if (direct && /^https?:\/\//i.test(direct)) return direct;
  const wm = tags["image:wikimedia_commons"]?.trim();
  if (wm) {
    const name = wm.replace(/^File:/i, "");
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}`;
  }
  return null;
}

function trailServiceDescriptionFromTags(tags: Record<string, string>): string | null {
  const d =
    tags.description?.trim() ||
    tags["description:it"]?.trim() ||
    tags["description:en"]?.trim() ||
    tags.note?.trim();
  return d || null;
}

function trailServicePhoneFromTags(tags: Record<string, string>): string | null {
  const p = tags.phone?.trim() || tags["contact:phone"]?.trim();
  return p || null;
}

function trailServiceWebsiteFromTags(tags: Record<string, string>): string | null {
  const w = tags.website?.trim() || tags["contact:website"]?.trim() || tags.url?.trim();
  if (!w) return null;
  if (/^https?:\/\//i.test(w)) return w;
  return `https://${w}`;
}

/** Rifugi, bivacchi, ripari e ristoranti (nodi OSM) nel bbox. */
export async function fetchTrailServicesInBbox(
  south: number,
  west: number,
  north: number,
  east: number,
  limit = 45
): Promise<TrailServicePoi[]> {
  const q = `
[out:json][timeout:50];
(
  node["tourism"="alpine_hut"](${south},${west},${north},${east});
  node["tourism"="wilderness_hut"](${south},${west},${north},${east});
  node["amenity"="shelter"](${south},${west},${north},${east});
  node["amenity"="restaurant"](${south},${west},${north},${east});
);
out body;
`;
  const formBody = `data=${encodeURIComponent(q)}`;
  const res = await fetchOverpassInterpreter(formBody);
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}`);
  }
  const j = (await res.json()) as {
    elements?: Array<{
      type: string;
      lat?: number;
      lon?: number;
      tags?: Record<string, string>;
    }>;
  };
  const out: TrailServicePoi[] = [];
  for (const el of j.elements ?? []) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    const tags = el.tags ?? {};
    let kind: TrailServicePoi["kind"] = "shelter";
    if (tags.tourism === "alpine_hut") kind = "hut";
    else if (tags.tourism === "wilderness_hut") kind = "bivouac";
    else if (tags.amenity === "shelter") kind = "shelter";
    else if (tags.amenity === "restaurant") kind = "restaurant";
    out.push({
      lat: el.lat,
      lng: el.lon,
      name: tags.name ?? tags.ref ?? null,
      kind,
      description: trailServiceDescriptionFromTags(tags),
      phone: trailServicePhoneFromTags(tags),
      website: trailServiceWebsiteFromTags(tags),
      image_url: trailServiceImageFromTags(tags),
    });
  }
  return out.slice(0, limit);
}

function dedupeTrailServicePois(pois: TrailServicePoi[], limit: number): TrailServicePoi[] {
  const m = new Map<string, TrailServicePoi>();
  for (const p of pois) {
    const k = `${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`;
    if (!m.has(k)) m.set(k, p);
  }
  return [...m.values()].slice(0, limit);
}

/** Rifugi/servizi in corridoio lungo il percorso. */
export async function fetchTrailServicesAlongCorridor(
  samplePointsLngLat: Position[],
  radiusM: number,
  limit = 55
): Promise<TrailServicePoi[]> {
  if (samplePointsLngLat.length === 0) return [];
  const r = Math.max(80, Math.min(2000, Math.floor(radiusM)));
  const lines: string[] = [];
  for (const c of samplePointsLngLat) {
    const lat = c[1];
    const lon = c[0];
    lines.push(`  node["tourism"="alpine_hut"](around:${r},${lat},${lon});`);
    lines.push(`  node["tourism"="wilderness_hut"](around:${r},${lat},${lon});`);
    lines.push(`  node["amenity"="shelter"](around:${r},${lat},${lon});`);
    lines.push(`  node["amenity"="restaurant"](around:${r},${lat},${lon});`);
  }
  const q = `
[out:json][timeout:55];
(
${lines.join("\n")}
);
out body;
`;
  const formBody = `data=${encodeURIComponent(q)}`;
  const res = await fetchOverpassInterpreter(formBody);
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}`);
  }
  const j = (await res.json()) as {
    elements?: Array<{
      type: string;
      lat?: number;
      lon?: number;
      tags?: Record<string, string>;
    }>;
  };
  const out: TrailServicePoi[] = [];
  for (const el of j.elements ?? []) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    const tags = el.tags ?? {};
    let kind: TrailServicePoi["kind"] = "shelter";
    if (tags.tourism === "alpine_hut") kind = "hut";
    else if (tags.tourism === "wilderness_hut") kind = "bivouac";
    else if (tags.amenity === "shelter") kind = "shelter";
    else if (tags.amenity === "restaurant") kind = "restaurant";
    out.push({
      lat: el.lat,
      lng: el.lon,
      name: tags.name ?? tags.ref ?? null,
      kind,
      description: trailServiceDescriptionFromTags(tags),
      phone: trailServicePhoneFromTags(tags),
      website: trailServiceWebsiteFromTags(tags),
      image_url: trailServiceImageFromTags(tags),
    });
  }
  return dedupeTrailServicePois(out, limit);
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Punteggio nome utente vs OSM (0–100). */
function lodgingNameMatchScore(hint: string, osmName: string | null): number {
  if (!osmName?.trim()) return 0;
  const h = stripDiacritics(hint.toLowerCase().trim());
  const o = stripDiacritics(osmName.toLowerCase().trim());
  if (!h || !o) return 0;
  if (h.includes(o) || o.includes(h)) return 100;
  const hw = h.split(/\s+/).filter((w) => w.length > 1);
  const ow = o.split(/\s+/);
  let n = 0;
  for (const w of hw) {
    if (ow.some((x) => x.includes(w) || w.includes(x))) n++;
  }
  return Math.min(100, n * 25);
}

/**
 * Rifugio OSM più plausibile vicino al punto (alpine_hut / wilderness_hut).
 * Usato per arricchire telefono, sito, immagine da tag OSM.
 */
export async function fetchNearestLodgingOsm(
  lat: number,
  lng: number,
  nameHint: string,
  radiusM = 2500
): Promise<TrailServicePoi | null> {
  const r = Math.max(200, Math.min(6000, radiusM));
  const q = `
[out:json][timeout:45];
(
  node["tourism"="alpine_hut"](around:${r},${lat},${lng});
  node["tourism"="wilderness_hut"](around:${r},${lat},${lng});
);
out body;
`;
  const formBody = `data=${encodeURIComponent(q)}`;
  const res = await fetchOverpassInterpreter(formBody);
  if (!res.ok) return null;
  const j = (await res.json()) as {
    elements?: Array<{
      type: string;
      lat?: number;
      lon?: number;
      tags?: Record<string, string>;
    }>;
  };
  type Cand = { poi: TrailServicePoi; score: number };
  const cands: Cand[] = [];
  for (const el of j.elements ?? []) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    const tags = el.tags ?? {};
    const kind: TrailServicePoi["kind"] =
      tags.tourism === "wilderness_hut" ? "bivouac" : "hut";
    const poi: TrailServicePoi = {
      lat: el.lat,
      lng: el.lon,
      name: tags.name ?? tags.ref ?? null,
      kind,
      description: trailServiceDescriptionFromTags(tags),
      phone: trailServicePhoneFromTags(tags),
      website: trailServiceWebsiteFromTags(tags),
      image_url: trailServiceImageFromTags(tags),
    };
    const dist = haversineM(lat, lng, el.lat, el.lon);
    const nm = lodgingNameMatchScore(nameHint, poi.name);
    const score = nm * 2 - dist / 80;
    cands.push({ poi, score });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.score - a.score);
  return cands[0]!.poi;
}
