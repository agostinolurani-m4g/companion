import { simplifyLineString, simplifyLineStringWithIndices, simplifyToMaxPoints } from "@/lib/line-simplify";

const R = 6371008.8;

/** Distanza in metri fra due punti lng/lat (formula dell'haversine). */
export function haversineM(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** LineString compatta per storage (DP ~5 m, max 4000 vertici, 2D + ele opzionale). */
export function compactLine(points: { lng: number; lat: number; ele?: number }[]): GeoJSON.LineString {
  const coords = points.map((p) => (p.ele != null ? [p.lng, p.lat, Math.round(p.ele)] : [p.lng, p.lat]));
  const simplified = simplifyToMaxPoints(simplifyLineString(coords, 0.00005), 4000);
  return {
    type: "LineString",
    coordinates: simplified.map((c) =>
      c.length > 2
        ? [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6, c[2]]
        : [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6],
    ),
  };
}


/**
 * Come `compactLine` ma conserva anche i tempi: `times[i]` sono i secondi dalla
 * partenza del vertice i della linea compatta (null se il file non ha orari).
 * Servono ai segmenti per misurare il tempo fra due punti.
 */
export function compactTrack(points: { lng: number; lat: number; ele?: number; t?: number }[]): {
  line: GeoJSON.LineString;
  times: number[] | null;
} {
  const coords = points.map((p) => (p.ele != null ? [p.lng, p.lat, Math.round(p.ele)] : [p.lng, p.lat]));
  let { indices } = simplifyLineStringWithIndices(coords, 0.00005);
  if (indices.length > 4000) {
    const step = (indices.length - 1) / 3999;
    const picked: number[] = [];
    for (let i = 0; i < 4000; i++) picked.push(indices[Math.min(indices.length - 1, Math.round(i * step))]);
    indices = picked;
  }
  const round = (c: number[]) =>
    c.length > 2
      ? [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6, c[2]]
      : [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];
  const line: GeoJSON.LineString = { type: "LineString", coordinates: indices.map((i) => round(coords[i])) };
  const t0 = points.find((p) => p.t != null)?.t;
  const allTimed = t0 != null && indices.every((i) => points[i].t != null);
  const times = allTimed ? indices.map((i) => Math.round(((points[i].t as number) - t0) / 1000)) : null;
  return { line, times };
}
