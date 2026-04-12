import type { StopRow } from "@/lib/types";

/** Distanza punto–segmento in spazio lng/lat (approssimazione locale). */
function distPointToSegment(
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
 * Indice `order_index` dove inserire la nuova tappa così che resti “lungo il percorso”
 * tra due tappe consecutive (punto più vicino a un segmento). Se lontano da tutti i segmenti,
 * in coda.
 */
export function computeInsertionOrderIndex(
  sortedStops: StopRow[],
  lat: number,
  lng: number,
  maxDistDeg = 0.15
): number {
  const p: [number, number] = [lng, lat];
  if (sortedStops.length === 0) return 0;
  if (sortedStops.length === 1) return 1;

  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < sortedStops.length - 1; i++) {
    const a: [number, number] = [sortedStops[i].lng, sortedStops[i].lat];
    const b: [number, number] = [sortedStops[i + 1].lng, sortedStops[i + 1].lat];
    const d = distPointToSegment(p, a, b);
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
