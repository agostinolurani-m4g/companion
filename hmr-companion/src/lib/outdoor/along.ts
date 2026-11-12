import type { Position } from "geojson";
import type { OutdoorFeatureRow } from "./store";

const R_M = 6371000;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLng = (lng2 - lng1) * toR;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R_M * Math.asin(Math.sqrt(a));
}

function distPointToSegmentM(
  plat: number,
  plng: number,
  alat: number,
  alng: number,
  blat: number,
  blng: number,
): number {
  const cos = Math.cos((plat * Math.PI) / 180);
  const ax = alng * cos;
  const ay = alat;
  const bx = blng * cos;
  const by = blat;
  const px = plng * cos;
  const py = plat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-18) {
    t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const nx = ax + t * dx;
  const ny = ay + t * dy;
  const dLng = (nx - px) / cos;
  const dLat = ny - py;
  return Math.sqrt(dLat * dLat + dLng * dLng) * (Math.PI / 180) * R_M;
}

function cumKmAlongRoute(coords: [number, number][]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    const [lng0, lat0] = coords[i - 1];
    const [lng1, lat1] = coords[i];
    cum.push(cum[i - 1] + haversineM(lat0, lng0, lat1, lng1) / 1000);
  }
  return cum;
}

export type AlongFeatureHit = {
  feature: OutdoorFeatureRow;
  distM: number;
  alongKm: number;
};

export function featuresAlongRoute(
  route: [number, number][],
  features: OutdoorFeatureRow[],
  maxDistM = 150,
): AlongFeatureHit[] {
  if (route.length < 2) return [];
  const cum = cumKmAlongRoute(route);
  const hits: AlongFeatureHit[] = [];

  for (const f of features) {
    let bestDist = Infinity;
    let bestAlong = 0;
    for (let i = 0; i < route.length - 1; i++) {
      const [lng0, lat0] = route[i];
      const [lng1, lat1] = route[i + 1];
      const d = distPointToSegmentM(f.lat, f.lng, lat0, lng0, lat1, lng1);
      if (d < bestDist) {
        bestDist = d;
        const segLen = haversineM(lat0, lng0, lat1, lng1);
        const midAlong = cum[i] + (cum[i + 1] - cum[i]) * 0.5;
        bestAlong = midAlong;
        if (segLen > 1) {
          const t = 0.5;
          bestAlong = cum[i] + t * (cum[i + 1] - cum[i]);
        }
      }
    }
    if (bestDist <= maxDistM) {
      hits.push({ feature: f, distM: bestDist, alongKm: bestAlong });
    }
  }

  hits.sort((a, b) => a.alongKm - b.alongKm);
  return hits;
}

/** Bounding box espanso intorno alla polyline (metri). */
export function bboxAroundRoute(coords: Position[], padM: number): {
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
    const lng = c[0];
    const lat = c[1];
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  const d = padM / 111_320;
  return { south: south - d, north: north + d, west: west - d, east: east + d };
}
