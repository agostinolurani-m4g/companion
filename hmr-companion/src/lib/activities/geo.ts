import { simplifyLineString, simplifyToMaxPoints } from "@/lib/line-simplify";

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

