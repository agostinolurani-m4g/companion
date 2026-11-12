/**
 * Fatti di un itinerario OSM ricavati dalle way membro (sac_scale, fondo, tratti attrezzati)
 * e punteggio di qualità della relazione. Funzioni pure.
 */
import { OSM_SAC_TO_T } from "@/lib/content/difficulty-scales";

export type WayInfo = { lengthM: number; tags: Record<string, string> };

export type OsmWayFacts = {
  /** Grado SAC più alto incontrato (T1–T6). */
  sac_max: string | null;
  /** Grado SAC prevalente per lunghezza. */
  sac_prevalent: string | null;
  /** Quota della lunghezza con sac_scale noto (0–1). */
  sac_share: number;
  /** Fondo prevalente per lunghezza (valore OSM `surface`). */
  surface: string | null;
  /** Quota asfaltata/pavimentata (0–1) sulla lunghezza con fondo noto. */
  paved_share: number | null;
  /** Metri di tratti attrezzati (via ferrata, corde fisse). */
  equipped_m: number;
  /** Grado mtb:scale più alto. */
  mtb_scale_max: string | null;
  ways: number;
};

const PAVED = new Set(["asphalt", "paved", "concrete", "concrete:plates", "paving_stones", "sett", "chipseal", "metal"]);

const T_ORDER = ["T1", "T2", "T3", "T4", "T5", "T6"];

function isEquipped(t: Record<string, string>): boolean {
  return (
    t.highway === "via_ferrata" ||
    t.via_ferrata_scale != null ||
    t.safety_rope === "yes" ||
    t.climbing_aids === "yes"
  );
}

function prevalent(map: Map<string, number>): string | null {
  let best: string | null = null;
  let bestV = 0;
  for (const [k, v] of map) {
    if (v > bestV) {
      best = k;
      bestV = v;
    }
  }
  return best;
}

export function aggregateWayFacts(ways: WayInfo[]): OsmWayFacts {
  let total = 0;
  let sacLen = 0;
  let sacMaxIdx = -1;
  const sacBy = new Map<string, number>();
  const surfBy = new Map<string, number>();
  let surfLen = 0;
  let pavedLen = 0;
  let equipped = 0;
  let mtbMax = -1;
  for (const w of ways) {
    const len = Math.max(0, w.lengthM || 0);
    const t = w.tags ?? {};
    total += len;
    const sac = OSM_SAC_TO_T[(t.sac_scale ?? "").trim()];
    if (sac) {
      sacLen += len;
      sacBy.set(sac, (sacBy.get(sac) ?? 0) + len);
      sacMaxIdx = Math.max(sacMaxIdx, T_ORDER.indexOf(sac));
    }
    const surf = t.surface?.trim();
    if (surf) {
      surfLen += len;
      surfBy.set(surf, (surfBy.get(surf) ?? 0) + len);
      if (PAVED.has(surf)) pavedLen += len;
    }
    if (isEquipped(t)) equipped += len;
    const mtb = Number.parseInt(t["mtb:scale"] ?? "", 10);
    if (Number.isFinite(mtb) && mtb >= 0 && mtb <= 6) mtbMax = Math.max(mtbMax, mtb);
  }
  return {
    sac_max: sacMaxIdx >= 0 ? T_ORDER[sacMaxIdx]! : null,
    sac_prevalent: prevalent(sacBy),
    sac_share: total > 0 ? Math.round((sacLen / total) * 100) / 100 : 0,
    surface: prevalent(surfBy),
    paved_share: surfLen > 0 ? Math.round((pavedLen / surfLen) * 100) / 100 : null,
    equipped_m: Math.round(equipped),
    mtb_scale_max: mtbMax >= 0 ? String(mtbMax) : null,
    ways: ways.length,
  };
}

/**
 * Qualità 0–1 di un itinerario importato: declassa spezzoni corti, relazioni frammentate o
 * parziali e itinerari senza nome/segnavia.
 */
export function routeQuality(input: {
  length_km: number;
  coverage?: number | null;
  chains?: number | null;
  hasName?: boolean;
  hasRef?: boolean;
}): number {
  let q = 1;
  const km = input.length_km;
  if (km < 1) q *= 0.3;
  else if (km < 2) q *= 0.5;
  else if (km < 4) q *= 0.85;
  const cov = input.coverage ?? 1;
  if (cov < 0.9) q *= Math.max(0.2, cov);
  if ((input.chains ?? 1) > 3) q *= 0.8;
  if (input.hasName === false && input.hasRef === false) q *= 0.8;
  return Math.round(Math.max(0, Math.min(1, q)) * 100) / 100;
}

/** Lunghezza in metri di una geometria Overpass ({lat,lon}[]). */
export function overpassGeomLengthM(geom: ({ lat: number; lon: number } | null)[] | undefined): number {
  if (!geom) return 0;
  let s = 0;
  let prev: { lat: number; lon: number } | null = null;
  for (const g of geom) {
    if (!g || !Number.isFinite(g.lat) || !Number.isFinite(g.lon)) continue;
    if (prev) {
      const dx = (g.lon - prev.lon) * 111_320 * Math.cos((((g.lat + prev.lat) / 2) * Math.PI) / 180);
      const dy = (g.lat - prev.lat) * 110_540;
      s += Math.hypot(dx, dy);
    }
    prev = g;
  }
  return s;
}
