import type { Position } from "geojson";

export type BBox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

function haversineM(a: Position, b: Position): number {
  const R = 6371000;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dP = ((lat2 - lat1) * Math.PI) / 180;
  const dL = ((lng2 - lng1) * Math.PI) / 180;
  const x =
    Math.sin(dP / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dL / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function computeBBox(coords: Position[]): BBox | null {
  if (coords.length === 0) return null;
  let minLng = coords[0][0];
  let maxLng = coords[0][0];
  let minLat = coords[0][1];
  let maxLat = coords[0][1];
  for (const c of coords) {
    minLng = Math.min(minLng, c[0]);
    maxLng = Math.max(maxLng, c[0]);
    minLat = Math.min(minLat, c[1]);
    maxLat = Math.max(maxLat, c[1]);
  }
  return { minLng, minLat, maxLng, maxLat };
}

export function totalDistanceM(coords: Position[]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) {
    d += haversineM(coords[i - 1], coords[i]);
  }
  return d;
}

/** Dislivello da quota per punto (ele in m). Ignora segmenti senza entrambe le quote. */
export function elevationGainLossM(elevations: (number | undefined)[]): {
  gain: number;
  loss: number;
} {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < elevations.length; i++) {
    const a = elevations[i - 1];
    const b = elevations[i];
    if (a == null || b == null) continue;
    const d = b - a;
    if (d > 0) gain += d;
    else loss += -d;
  }
  return { gain, loss };
}

export type TrackSummaryStats = {
  point_count: number;
  distance_m: number;
  elevation_gain_m: number;
  elevation_loss_m: number;
  bbox: BBox;
  has_elevation: boolean;
  duration_sec: number | null;
};

/** Parti approssimative a pari distanza (per riassunto LLM senza punti grezzi). */
export function segmentSummariesEqualDistance(
  coords: Position[],
  elevations: (number | undefined)[],
  parts: number
): Array<{ part: number; distance_m: number; elev_gain_m: number }> {
  if (coords.length < 2 || parts < 1) return [];
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversineM(coords[i - 1], coords[i]));
  }
  const total = cum[cum.length - 1];
  if (total <= 0) return [];
  const out: Array<{ part: number; distance_m: number; elev_gain_m: number }> = [];
  for (let p = 0; p < parts; p++) {
    const d0 = (p / parts) * total;
    const d1 = ((p + 1) / parts) * total;
    let gain = 0;
    for (let i = 1; i < coords.length; i++) {
      if (cum[i] < d0 || cum[i - 1] > d1) continue;
      const a = elevations[i - 1];
      const b = elevations[i];
      if (a == null || b == null) continue;
      const segD = cum[i] - cum[i - 1];
      if (segD <= 0) continue;
      const overlap0 = Math.max(d0, cum[i - 1]);
      const overlap1 = Math.min(d1, cum[i]);
      if (overlap1 <= overlap0) continue;
      const frac = (overlap1 - overlap0) / segD;
      const delta = b - a;
      if (delta > 0) gain += delta * frac;
    }
    out.push({
      part: p + 1,
      distance_m: d1 - d0,
      elev_gain_m: gain,
    });
  }
  return out;
}

export function summarizeTrack(
  coords: Position[],
  elevations: (number | undefined)[],
  timesSec: (number | null)[]
): TrackSummaryStats {
  const bbox = computeBBox(coords)!;
  const distance_m = totalDistanceM(coords);
  const { gain, loss } = elevationGainLossM(elevations);
  const has_elevation = elevations.some((e) => e != null);
  let duration_sec: number | null = null;
  const validTimes = timesSec.filter((t): t is number => t != null);
  if (validTimes.length >= 2) {
    const minT = Math.min(...validTimes);
    const maxT = Math.max(...validTimes);
    duration_sec = Math.max(0, maxT - minT);
  }
  return {
    point_count: coords.length,
    distance_m,
    elevation_gain_m: gain,
    elevation_loss_m: loss,
    bbox,
    has_elevation,
    duration_sec,
  };
}
