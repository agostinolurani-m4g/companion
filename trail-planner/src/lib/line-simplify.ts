import type { LineString, Position } from "geojson";

/** Distanza perpendicolare approssimata (gradi²) punto-segmento su piano lng/lat (ok per tratti corti). */
function perpendicularDist2(p: Position, a: Position, b: Position): number {
  const [px, py] = [p[0], p[1]];
  const [ax, ay] = [a[0], a[1]];
  const [bx, by] = [b[0], b[1]];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-24) {
    const d = px - ax;
    const e = py - ay;
    return d * d + e * e;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const nx = ax + t * dx;
  const ny = ay + t * dy;
  const d = px - nx;
  const e = py - ny;
  return d * d + e * e;
}

function douglasPeuckerRecursive(
  pts: Position[],
  start: number,
  end: number,
  epsilon2: number,
  keep: boolean[]
): void {
  if (end <= start + 1) return;
  let maxD = 0;
  let idx = start;
  for (let i = start + 1; i < end; i++) {
    const d = perpendicularDist2(pts[i], pts[start], pts[end]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > epsilon2) {
    keep[idx] = true;
    douglasPeuckerRecursive(pts, start, idx, epsilon2, keep);
    douglasPeuckerRecursive(pts, idx, end, epsilon2, keep);
  }
}

/**
 * Douglas–Peucker su [lng,lat].
 * `epsilonDeg` ~ 0.00005 ≈ pochi metri a lat medie; usare ~0.0001–0.0003 per tracce dense.
 */
export function simplifyLineString(
  coordinates: Position[],
  epsilonDeg = 0.00012
): Position[] {
  if (coordinates.length <= 2) return coordinates;
  const eps2 = epsilonDeg * epsilonDeg;
  const keep = new Array(coordinates.length).fill(false);
  keep[0] = true;
  keep[coordinates.length - 1] = true;
  douglasPeuckerRecursive(coordinates, 0, coordinates.length - 1, eps2, keep);
  return coordinates.filter((_, i) => keep[i]);
}

/** Riduce a massimo `maxPoints` campionando uniformemente dopo DP se serve. */
export function simplifyToMaxPoints(coordinates: Position[], maxPoints: number): Position[] {
  if (coordinates.length <= maxPoints) return coordinates;
  const step = (coordinates.length - 1) / (maxPoints - 1);
  const out: Position[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    out.push(coordinates[Math.min(idx, coordinates.length - 1)]);
  }
  return out;
}

export function lineStringFromPositions(coords: Position[]): LineString {
  return { type: "LineString", coordinates: coords };
}
