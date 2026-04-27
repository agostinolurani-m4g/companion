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
 * Douglas–Peucker iterativo per evitare stack overflow su tracce molto lunghe
 * (il GPX HMR ha ~100k punti: la ricorsione diretta esplode).
 */
export function simplifyLineString(
  coordinates: Position[],
  epsilonDeg = 0.00012
): Position[] {
  return simplifyLineStringWithIndices(coordinates, epsilonDeg).coords;
}

/**
 * Variante che restituisce anche gli **indici originali** dei vertici tenuti.
 * Serve quando a valle vogliamo mappare una grandezza calcolata sulla traccia
 * grezza (es. cum_km haversine) direttamente ai vertici semplificati, senza
 * ricalcolarla sulla polyline semplificata (dove i tornanti sotto ε vengono
 * "raddrizzati" e quindi la lunghezza risulta minore del file originale).
 */
export function simplifyLineStringWithIndices(
  coordinates: Position[],
  epsilonDeg = 0.00012
): { coords: Position[]; indices: number[] } {
  if (coordinates.length <= 2) {
    return {
      coords: coordinates.slice(),
      indices: coordinates.map((_, i) => i),
    };
  }
  const eps2 = epsilonDeg * epsilonDeg;
  const keep = new Array(coordinates.length).fill(false);
  keep[0] = true;
  keep[coordinates.length - 1] = true;
  const stack: Array<[number, number]> = [[0, coordinates.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    if (end <= start + 1) continue;
    let maxD = 0;
    let idx = start;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDist2(coordinates[i], coordinates[start], coordinates[end]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps2) {
      keep[idx] = true;
      stack.push([start, idx]);
      stack.push([idx, end]);
    }
  }
  void douglasPeuckerRecursive;
  const coords: Position[] = [];
  const indices: number[] = [];
  for (let i = 0; i < coordinates.length; i++) {
    if (keep[i]) {
      coords.push(coordinates[i]);
      indices.push(i);
    }
  }
  return { coords, indices };
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
