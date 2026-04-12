import type { Position } from "geojson";

const R = 6371;

export function haversineKm(a: Position, b: Position): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Distanza cumulativa (km) per ogni vertice della polyline. */
export function cumulativeKmAlong(coords: Position[]): number[] {
  if (coords.length === 0) return [];
  const out: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    out.push(out[i - 1] + haversineKm(coords[i - 1], coords[i]));
  }
  return out;
}

/** Punto sulla polyline più vicino a `p` (lng,lat). `alongKm` = km dall’inizio traccia. */
export function nearestPointOnPolyline(
  coords: Position[],
  p: Position
): { alongKm: number; distKm: number; closest: Position } | null {
  if (coords.length < 2) return null;
  const cum = cumulativeKmAlong(coords);
  let bestDist = Infinity;
  let bestAlong = 0;
  let bestCoord: Position = coords[0];

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const segLen = cum[i + 1] - cum[i];
    if (segLen < 1e-9) {
      const d = haversineKm(p, a);
      if (d < bestDist) {
        bestDist = d;
        bestAlong = cum[i];
        bestCoord = a;
      }
      continue;
    }
    // Approssimazione locale: interpolazione lineare su lng/lat (tratti corti).
    let t =
      ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) /
      ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
    t = Math.max(0, Math.min(1, t));
    const q: Position = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const d = haversineKm(p, q);
    if (d < bestDist) {
      bestDist = d;
      bestAlong = cum[i] + t * segLen;
      bestCoord = q;
    }
  }
  return { alongKm: bestAlong, distKm: bestDist, closest: bestCoord };
}

/** km lungo la traccia proiettando uno stop sulla polyline. */
export function kmAlongLineForStop(stopLng: number, stopLat: number, coords: Position[]): number | null {
  const n = nearestPointOnPolyline(coords, [stopLng, stopLat]);
  return n ? n.alongKm : null;
}

function positionAtKm(coords: Position[], cum: number[], km: number): Position {
  if (km <= cum[0]) return coords[0];
  const last = cum.length - 1;
  if (km >= cum[last]) return coords[last];
  for (let i = 0; i < last; i++) {
    if (km >= cum[i] && km <= cum[i + 1]) {
      const seg = cum[i + 1] - cum[i];
      const t = seg < 1e-12 ? 0 : (km - cum[i]) / seg;
      const A = coords[i];
      const B = coords[i + 1];
      return [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])];
    }
  }
  return coords[last];
}

/** Estrae la sottotraccia [lo, hi] km dall’inizio (estremi interpolati). */
export function sliceCoordsByKmRange(coords: Position[], startKm: number, endKm: number): Position[] {
  if (coords.length < 2) return [...coords];
  const lo = Math.min(startKm, endKm);
  const hi = Math.max(startKm, endKm);
  const cum = cumulativeKmAlong(coords);
  const start = positionAtKm(coords, cum, lo);
  const end = positionAtKm(coords, cum, hi);
  const out: Position[] = [start];
  for (let i = 0; i < coords.length; i++) {
    if (cum[i] > lo && cum[i] < hi) out.push(coords[i]);
  }
  const last = out[out.length - 1];
  if (last[0] !== end[0] || last[1] !== end[1]) out.push(end);
  return out.length >= 2 ? out : [start, end];
}
