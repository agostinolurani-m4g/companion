/**
 * Classifica superficie da tag OSM (highway / surface / tracktype).
 * Euristica per trail/ultra: asfalto vs sterrato/strada bianca vs single/stretto.
 */

import type { OsmWayGeom } from "./overpass";

export type TrackSurfaceKind = "asphalt" | "gravel" | "single" | "unknown";

const PAVED = new Set([
  "asphalt",
  "paved",
  "concrete",
  "paving_stones",
  "sett",
  "metal",
]);

const UNPAVED = new Set([
  "gravel",
  "fine_gravel",
  "pebblestone",
  "compacted",
  "dirt",
  "earth",
  "grass",
  "ground",
  "mud",
  "sand",
  "wood",
  "unpaved",
  "rock",
]);

/** Classifica da tag way OSM. */
export function classifyOsmHighwaySurface(tags: Record<string, string> | undefined): TrackSurfaceKind {
  if (!tags) return "unknown";
  const hw = (tags.highway || "").trim();
  const surf = (tags.surface || "").toLowerCase().trim();
  const tt = (tags.tracktype || "").toLowerCase().trim();

  if (surf && PAVED.has(surf)) return "asphalt";
  if (surf && UNPAVED.has(surf)) {
    if (surf === "compacted" && (hw === "track" || hw === "unclassified")) return "gravel";
    if (["path", "footway", "bridleway", "steps"].includes(hw)) return "single";
    return "gravel";
  }

  if (["path", "bridleway", "steps", "via_ferrata"].includes(hw)) return "single";
  if (hw === "footway" || hw === "pedestrian") return "single";

  if (hw === "track") {
    if (tt === "grade1" && !surf) return "gravel";
    if (["grade4", "grade5"].includes(tt)) return "single";
    return "gravel";
  }

  if (
    [
      "motorway",
      "motorway_link",
      "trunk",
      "trunk_link",
      "primary",
      "primary_link",
      "secondary",
      "secondary_link",
      "tertiary",
      "tertiary_link",
    ].includes(hw)
  ) {
    if (UNPAVED.has(surf)) return "gravel";
    return "asphalt";
  }

  if (["living_street", "residential", "service", "road"].includes(hw)) {
    if (UNPAVED.has(surf)) return "gravel";
    if (PAVED.has(surf)) return "asphalt";
    return "gravel";
  }

  if (hw === "unclassified") {
    if (PAVED.has(surf)) return "asphalt";
    return "gravel";
  }

  if (hw === "cycleway") {
    if (UNPAVED.has(surf)) return "gravel";
    return "asphalt";
  }

  if (hw) return "unknown";
  return "unknown";
}

/** Distanza approssimata in metri (piano locale). */
export function approxDistanceM(lng: number, lat: number, lng2: number, lat2: number): number {
  const cos = Math.cos((lat * Math.PI) / 180);
  const dx = (lng2 - lng) * 111_320 * cos;
  const dy = (lat2 - lat) * 111_320;
  return Math.hypot(dx, dy);
}

export function distPointToSegmentM(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-22) return approxDistanceM(px, py, x1, y1);
  const cos = Math.cos((py * Math.PI) / 180);
  const mx = dx * 111_320 * cos;
  const my = dy * 111_320;
  const pxm = (px - x1) * 111_320 * cos;
  const pym = (py - y1) * 111_320;
  let t = (pxm * mx + pym * my) / (mx * mx + my * my);
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return approxDistanceM(px, py, qx, qy);
}

export type WaySeg = { wayId: number; ax: number; ay: number; bx: number; by: number; tags: Record<string, string> };

/** Espande ways in segmenti consecutivi. */
export function waysToSegments(ways: OsmWayGeom[]): WaySeg[] {
  const out: WaySeg[] = [];
  for (const w of ways) {
    const g = w.geometry!;
    const tags = w.tags ?? {};
    for (let i = 0; i < g.length - 1; i++) {
      const a = g[i];
      const b = g[i + 1];
      out.push({
        wayId: w.id,
        ax: a.lon,
        ay: a.lat,
        bx: b.lon,
        by: b.lat,
        tags,
      });
    }
  }
  return out;
}

const MAX_MATCH_M = 120;

/** Trova il segmento strada più vicino e ne deriva la superficie. */
export function surfaceAtPoint(
  lng: number,
  lat: number,
  segments: WaySeg[],
  maxM = MAX_MATCH_M
): TrackSurfaceKind {
  let best = maxM;
  let tags: Record<string, string> = {};
  for (const s of segments) {
    const d = distPointToSegmentM(lng, lat, s.ax, s.ay, s.bx, s.by);
    if (d < best) {
      best = d;
      tags = s.tags;
    }
  }
  if (best >= maxM) return "unknown";
  return classifyOsmHighwaySurface(tags);
}

/** Mediana mobile su classi (indici enum). */
export function medianSmoothKinds(kinds: TrackSurfaceKind[], window: number): TrackSurfaceKind[] {
  if (kinds.length === 0) return [];
  const rank: Record<TrackSurfaceKind, number> = {
    unknown: 0,
    gravel: 1,
    single: 2,
    asphalt: 3,
  };
  const unrank: TrackSurfaceKind[] = ["unknown", "gravel", "single", "asphalt"];
  const half = Math.floor(window / 2);
  const out: TrackSurfaceKind[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(kinds.length, i + half + 1);
    const slice = kinds.slice(lo, hi).map((k) => rank[k]);
    slice.sort((a, b) => a - b);
    const mid = slice[Math.floor(slice.length / 2)]!;
    out.push(unrank[mid] ?? "unknown");
  }
  return out;
}

/** Segmenti con km (es. da DB o chart). */
export type SurfaceKmSpan = { km_start: number; km_end: number; surface: TrackSurfaceKind };

/** Superficie OSM al km `km` (primo span che contiene il punto). */
export function surfaceKindAtKm(
  segments: ReadonlyArray<SurfaceKmSpan>,
  km: number
): TrackSurfaceKind | null {
  if (!Number.isFinite(km) || segments.length === 0) return null;
  for (const s of segments) {
    if (km + 1e-6 >= s.km_start && km - 1e-6 <= s.km_end) return s.surface;
  }
  return null;
}

/** Superficie prevalente lungo [kmLo, kmHi] campionando gli span OSM. */
export function dominantSurfaceAlongKm(
  segments: ReadonlyArray<SurfaceKmSpan>,
  kmLo: number,
  kmHi: number,
  samples = 14
): TrackSurfaceKind | null {
  const lo = Math.min(kmLo, kmHi);
  const hi = Math.max(kmLo, kmHi);
  if (hi - lo < 1e-6) return surfaceKindAtKm(segments, lo);
  const counts = new Map<TrackSurfaceKind, number>();
  for (let i = 0; i <= samples; i++) {
    const km = lo + ((hi - lo) * i) / samples;
    const k = surfaceKindAtKm(segments, km);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: TrackSurfaceKind | null = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

export function formatTerrainIt(s: TrackSurfaceKind): string {
  switch (s) {
    case "asphalt":
      return "Asfalto";
    case "gravel":
      return "Sterrato";
    case "single":
      return "Single / sentiero";
    default:
      return "Non class.";
  }
}

export type SurfaceSpan = { km_start: number; km_end: number; surface: TrackSurfaceKind };

/** Unisce campioni consecutivi con stessa superficie. */
export function mergeSurfaceSpans(
  km: number[],
  kinds: TrackSurfaceKind[],
  lengthKm: number
): SurfaceSpan[] {
  if (km.length === 0 || km.length !== kinds.length) return [];
  const spans: SurfaceSpan[] = [];
  let startKm = km[0]!;
  let cur = kinds[0]!;
  for (let i = 1; i < km.length; i++) {
    const k = km[i]!;
    const kind = kinds[i]!;
    if (kind !== cur) {
      spans.push({ km_start: startKm, km_end: k, surface: cur });
      startKm = k;
      cur = kind;
    }
  }
  spans.push({ km_start: startKm, km_end: lengthKm, surface: cur });
  return spans;
}
