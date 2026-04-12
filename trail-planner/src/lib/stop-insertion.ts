import type { Position } from "geojson";
import type { StopRow } from "@/lib/types";
import { kmAlongLineForStop, nearestPointOnPolyline } from "@/lib/track-geometry";

/**
 * Inserimento tappa “stile planner outdoor” (Komoot / Strava):
 * con una **LineString** salvata (GPX/OSRM), il click si proietta sulla polyline e la
 * nuova tappa va **nell’ordine lungo il percorso**, non solo sulla corda tra tappe.
 * Senza traccia, si usa la corda tra tappe consecutive (fallback).
 */

const EPS_KM = 0.003;
/** Oltre questa distanza dalla linea si usa il fallback a corda. */
const DEFAULT_MAX_SNAP_KM = 2.5;

/** Distanza punto–segmento in spazio lng/lat (approssimazione locale) — fallback senza GPX. */
function distPointToSegmentDeg(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const [x, y] = p;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.hypot(x - x1, y - y1);
  let t = ((x - x1) * dx + (y - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(x - px, y - py);
}

/**
 * Fallback: solo tappe, nessuna polyline — segmenti retti tra tappe consecutive.
 */
export function computeInsertionOrderIndexChord(
  sortedStops: StopRow[],
  lat: number,
  lng: number,
  maxDistDeg = 0.02
): number {
  const p: [number, number] = [lng, lat];
  if (sortedStops.length === 0) return 0;
  if (sortedStops.length === 1) return 1;

  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < sortedStops.length - 1; i++) {
    const a: [number, number] = [sortedStops[i].lng, sortedStops[i].lat];
    const b: [number, number] = [sortedStops[i + 1].lng, sortedStops[i + 1].lat];
    const d = distPointToSegmentDeg(p, a, b);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }

  if (bestD <= maxDistDeg) {
    return sortedStops[bestI].order_index + 1;
  }
  return sortedStops[sortedStops.length - 1].order_index + 1;
}

/**
 * `sortedStops`: ordinati per `order_index`.
 * `lineCoords`: vertici della traccia (stesso senso del percorso).
 */
function insertionOrderFromPathKm(
  sortedStops: StopRow[],
  kmClick: number,
  lineCoords: Position[]
): number | null {
  if (sortedStops.length === 0) return 0;

  const withKm = sortedStops.map((s) => {
    const km = kmAlongLineForStop(s.lng, s.lat, lineCoords);
    return km == null ? null : { s, km };
  });
  if (withKm.some((x) => x === null)) return null;

  const path: { s: StopRow; km: number }[] = withKm as { s: StopRow; km: number }[];
  path.sort((a, b) => a.km - b.km);

  if (path.length === 1) {
    const { s, km } = path[0];
    return kmClick < km - EPS_KM ? s.order_index : s.order_index + 1;
  }

  /** Primo indice con km > kmClick (+tolleranza) → inserimento tra path[ins-1] e path[ins]. */
  let ins = 0;
  while (ins < path.length && path[ins].km <= kmClick + EPS_KM) {
    ins += 1;
  }
  if (ins === 0) {
    return path[0].s.order_index;
  }
  if (ins >= path.length) {
    return path[path.length - 1].s.order_index + 1;
  }

  const prev = path[ins - 1];
  const next = path[ins];
  const o0 = prev.s.order_index;
  const o1 = next.s.order_index;

  if (o0 < o1) {
    return o0 + 1;
  }
  if (o0 > o1) {
    return o1 + 1;
  }
  return o0 + 1;
}

export type InsertionOptions = {
  /** Distanza massima dalla polyline per usare la geometria (km). */
  maxSnapKm?: number;
};

/**
 * Calcola `order_index` dove inserire la nuova tappa.
 * Con `lineCoords` (traccia reale) usa la posizione lungo il percorso; altrimenti la corda tra tappe.
 */
export function computeInsertionOrderIndex(
  sortedStops: StopRow[],
  lat: number,
  lng: number,
  lineCoords: Position[] | null | undefined,
  opts?: InsertionOptions
): number {
  const maxSnap = opts?.maxSnapKm ?? DEFAULT_MAX_SNAP_KM;
  const coords = lineCoords?.length && lineCoords.length >= 2 ? lineCoords : null;

  if (coords) {
    const hit = nearestPointOnPolyline(coords, [lng, lat]);
    if (hit && hit.distKm <= maxSnap) {
      const k = insertionOrderFromPathKm(sortedStops, hit.alongKm, coords);
      if (k !== null) return k;
    }
  }

  return computeInsertionOrderIndexChord(sortedStops, lat, lng);
}
