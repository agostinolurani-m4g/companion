import type { StoredCoord } from "./track-coords";
import {
  ELEV_GAIN_DEFAULT_THRESHOLD_M,
  ELEV_GAIN_DEFAULT_WINDOW_PTS,
  elevationGainLoss,
  elevationGainLossSmoothed,
} from "./track-geometry";

const KM_EPS = 1e-9;

function gainLossFromElevProfile(profile: Array<number | null | undefined>): {
  gain: number;
  loss: number;
} {
  const filtered = profile.filter(
    (e): e is number => e != null && Number.isFinite(e)
  );
  if (filtered.length < 2) return { gain: 0, loss: 0 };
  const n = filtered.length;
  // Stessa logica ingest solo con abbastanza campioni: con n < finestra MA la
  // media mobile su tutta la polyline appiattisce il profilo (D+ arteficialmente basso).
  if (n < ELEV_GAIN_DEFAULT_WINDOW_PTS) {
    return elevationGainLoss(filtered);
  }
  return elevationGainLossSmoothed(filtered, {
    windowPts: ELEV_GAIN_DEFAULT_WINDOW_PTS,
    thresholdM: ELEV_GAIN_DEFAULT_THRESHOLD_M,
  });
}

export type ProjectedPoint = {
  alongKm: number;
  distKm: number;
  lng: number;
  lat: number;
  elev: number | null;
};

export type CoordAtKm = {
  lng: number;
  lat: number;
  elev: number | null;
};

export type MeasureResult = {
  distKm: number;
  gainM: number;
  lossM: number;
  elevA: number | null;
  elevB: number | null;
};

/** Da DB dopo ingest: riallinea D+/D- segmento al metodo ufficiale (GPX grezzo ITRA). */
export type MeasureBetweenOptions = {
  profileGainScale?: number;
  profileLossScale?: number;
};

const R_KM = 6371;
const TO_RAD = Math.PI / 180;

/**
 * Project a (lng, lat) pair onto the closest segment of the stored track.
 * Uses a cheap equirectangular approximation (sufficient for distances
 * measured at the scale of this app) and linearly interpolates the stored
 * cumulative km and elevation between the segment endpoints.
 */
export function projectLngLatToTrack(
  coords: StoredCoord[],
  lng: number,
  lat: number
): ProjectedPoint | null {
  if (coords.length < 2) return null;
  const cLat = Math.cos(lat * TO_RAD);
  let best: ProjectedPoint | null = null;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const segLen2 = dx * dx + dy * dy;
    let t = 0;
    if (segLen2 > 1e-18) {
      t = ((lng - a[0]) * dx + (lat - a[1]) * dy) / segLen2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const px = a[0] + t * dx;
    const py = a[1] + t * dy;
    const dLat = (py - lat) * TO_RAD;
    const dLon = (px - lng) * TO_RAD * cLat;
    const dKm = Math.sqrt(dLat * dLat + dLon * dLon) * R_KM;
    if (best == null || dKm < best.distKm) {
      const along = a[3] + t * (b[3] - a[3]);
      const ea = a[2];
      const eb = b[2];
      let elev: number | null = null;
      if (ea != null && eb != null) elev = ea + t * (eb - ea);
      else if (ea != null) elev = ea;
      else if (eb != null) elev = eb;
      best = { alongKm: along, distKm: dKm, lng: px, lat: py, elev };
    }
  }
  return best;
}

function findIndexAtKm(coords: StoredCoord[], km: number): number {
  let lo = 0;
  let hi = coords.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (coords[mid][3] <= km) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Interpolate the track coordinate at a given cumulative km.
 * Returns the endpoint coordinate if km is out of range.
 */
export function coordAtKm(coords: StoredCoord[], km: number): CoordAtKm | null {
  if (coords.length === 0) return null;
  if (km <= coords[0][3]) {
    const c = coords[0];
    return { lng: c[0], lat: c[1], elev: c[2] };
  }
  const last = coords[coords.length - 1];
  if (km >= last[3]) {
    return { lng: last[0], lat: last[1], elev: last[2] };
  }
  const i = findIndexAtKm(coords, km);
  const a = coords[i];
  const b = coords[i + 1];
  const seg = b[3] - a[3];
  const t = seg < 1e-9 ? 0 : (km - a[3]) / seg;
  let elev: number | null = null;
  if (a[2] != null && b[2] != null) elev = a[2] + t * (b[2] - a[2]);
  else if (a[2] != null) elev = a[2];
  else if (b[2] != null) elev = b[2];
  return {
    lng: a[0] + t * (b[0] - a[0]),
    lat: a[1] + t * (b[1] - a[1]),
    elev,
  };
}

/**
 * Measure distance and elevation gain/loss between two positions on the track,
 * identified by their cumulative km. Works in either order; gain/loss are
 * always computed following the forward direction (from min km to max km).
 */
export function measureBetween(
  coords: StoredCoord[],
  kmA: number,
  kmB: number,
  opts?: MeasureBetweenOptions
): MeasureResult {
  const gScale = opts?.profileGainScale ?? 1;
  const lScale = opts?.profileLossScale ?? 1;
  if (coords.length === 0) {
    return { distKm: 0, gainM: 0, lossM: 0, elevA: null, elevB: null };
  }
  const lo = Math.min(kmA, kmB);
  const hi = Math.max(kmA, kmB);
  const ptA = coordAtKm(coords, kmA);
  const ptB = coordAtKm(coords, kmB);
  if (lo === hi) {
    return {
      distKm: 0,
      gainM: 0,
      lossM: 0,
      elevA: ptA?.elev ?? null,
      elevB: ptB?.elev ?? null,
    };
  }
  const startIdx = findIndexAtKm(coords, lo);
  const endIdx = findIndexAtKm(coords, hi);
  const startElev = coordAtKm(coords, lo)?.elev ?? null;
  const endElev = coordAtKm(coords, hi)?.elev ?? null;

  const profile: Array<number | null> = [startElev];
  for (let i = startIdx + 1; i <= endIdx; i++) {
    profile.push(coords[i][2]);
  }
  const lastVertexKm = coords[endIdx][3];
  if (hi > lastVertexKm + KM_EPS) {
    profile.push(endElev);
  }
  const { gain, loss } = gainLossFromElevProfile(profile);

  return {
    distKm: hi - lo,
    gainM: gain * gScale,
    lossM: loss * lScale,
    elevA: ptA?.elev ?? null,
    elevB: ptB?.elev ?? null,
  };
}

/**
 * Return the track vertices forming a polyline between two km values,
 * including interpolated endpoints. Convenient for drawing a highlighted
 * segment on the map.
 */
export function polylineBetween(
  coords: StoredCoord[],
  kmA: number,
  kmB: number
): Array<[number, number]> {
  if (coords.length === 0) return [];
  const lo = Math.min(kmA, kmB);
  const hi = Math.max(kmA, kmB);
  const startPt = coordAtKm(coords, lo);
  const endPt = coordAtKm(coords, hi);
  if (!startPt || !endPt) return [];
  const startIdx = findIndexAtKm(coords, lo);
  const endIdx = findIndexAtKm(coords, hi);
  const out: Array<[number, number]> = [[startPt.lng, startPt.lat]];
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const c = coords[i];
    out.push([c[0], c[1]]);
  }
  out.push([endPt.lng, endPt.lat]);
  return out;
}
