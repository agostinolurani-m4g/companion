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

export function haversineMeters(a: Position, b: Position): number {
  return haversineKm(a, b) * 1000;
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

/** Punto sulla polyline più vicino a `p` (lng,lat). */
export function nearestPointOnPolyline(
  coords: Position[],
  p: Position,
  cumCached?: number[]
): { alongKm: number; distKm: number; closest: Position; segIndex: number; segT: number } | null {
  if (coords.length < 2) return null;
  const cum = cumCached ?? cumulativeKmAlong(coords);
  let bestDist = Infinity;
  let bestAlong = 0;
  let bestCoord: Position = coords[0];
  let bestSeg = 0;
  let bestT = 0;

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
        bestSeg = i;
        bestT = 0;
      }
      continue;
    }
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
      bestSeg = i;
      bestT = t;
    }
  }
  return { alongKm: bestAlong, distKm: bestDist, closest: bestCoord, segIndex: bestSeg, segT: bestT };
}

/** Interpolazione lineare elev fra due vertici. */
export function positionAtKm(coords: Position[], cum: number[], km: number): Position {
  if (km <= cum[0]) return coords[0];
  const last = cum.length - 1;
  if (km >= cum[last]) return coords[last];
  let lo = 0;
  let hi = last;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= km) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const t = seg < 1e-12 ? 0 : (km - cum[lo]) / seg;
  const A = coords[lo];
  const B = coords[hi];
  const out: Position = [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])];
  if (A[2] != null && B[2] != null) {
    out.push(A[2] + t * (B[2] - A[2]));
  }
  return out;
}

/** Vertici campionati lungo il percorso (per query OSM a corridoio). */
export function samplePointsAlongPolyline(
  coords: Position[],
  spacingKm: number,
  maxPoints: number,
  cumCached?: number[]
): Position[] {
  if (coords.length < 2) return coords.length === 1 ? [coords[0]] : [];
  const cum = cumCached ?? cumulativeKmAlong(coords);
  const total = cum[cum.length - 1];
  const out: Position[] = [coords[0]];
  if (total < 1e-6) {
    out.push(coords[coords.length - 1]);
    return dedupePositions(out);
  }
  let nextKm = spacingKm;
  while (nextKm < total - 1e-9 && out.length < maxPoints - 1) {
    out.push(positionAtKm(coords, cum, nextKm));
    nextKm += spacingKm;
  }
  const last = coords[coords.length - 1];
  const olast = out[out.length - 1];
  if (olast[0] !== last[0] || olast[1] !== last[1]) out.push(last);
  return dedupePositions(out).slice(0, maxPoints);
}

function dedupePositions(p: Position[]): Position[] {
  const s = new Set<string>();
  const r: Position[] = [];
  for (const c of p) {
    const k = `${c[0].toFixed(5)},${c[1].toFixed(5)}`;
    if (s.has(k)) continue;
    s.add(k);
    r.push(c);
  }
  return r;
}

/** Finestra (punti) e hysteresis (m) per D+/D- stile ITRA — stessi valori di `ingest`. */
export const ELEV_GAIN_DEFAULT_WINDOW_PTS = 15;
export const ELEV_GAIN_DEFAULT_THRESHOLD_M = 3;

/** D+ / D- cumulato dalla sequenza di altitudini. */
export function elevationGainLoss(elev: Array<number | null | undefined>): {
  gain: number;
  loss: number;
} {
  let gain = 0;
  let loss = 0;
  let prev: number | null = null;
  for (const e of elev) {
    if (e == null || !Number.isFinite(e)) continue;
    if (prev != null) {
      const d = e - prev;
      if (d > 0) gain += d;
      else loss += -d;
    }
    prev = e;
  }
  return { gain, loss };
}

function movingAverageElev(filtered: number[], windowPts: number): number[] {
  const n = filtered.length;
  const half = Math.floor(windowPts / 2);
  const smoothed = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let sum = 0;
    let count = 0;
    for (let j = lo; j <= hi; j++) {
      sum += filtered[j];
      count++;
    }
    smoothed[i] = sum / count;
  }
  return smoothed;
}

function distributeGainOnSteps(
  G: number,
  loIdx: number,
  hiIdx: number,
  smoothed: number[],
  deltaGain: number[]
): void {
  if (G <= 0 || hiIdx <= loIdx) return;
  let W = 0;
  const weights = new Array<number>(smoothed.length).fill(0);
  for (let jj = loIdx + 1; jj <= hiIdx; jj++) {
    const w = Math.max(0, smoothed[jj] - smoothed[jj - 1]);
    weights[jj] = w;
    W += w;
  }
  if (W > 1e-18) {
    for (let jj = loIdx + 1; jj <= hiIdx; jj++) {
      deltaGain[jj] += (G * weights[jj]) / W;
    }
  } else if (hiIdx >= 1) {
    deltaGain[hiIdx] += G;
  }
}

function distributeLossOnSteps(
  L: number,
  loIdx: number,
  hiIdx: number,
  smoothed: number[],
  deltaLoss: number[]
): void {
  if (L <= 0 || hiIdx <= loIdx) return;
  let W = 0;
  const weights = new Array<number>(smoothed.length).fill(0);
  for (let jj = loIdx + 1; jj <= hiIdx; jj++) {
    const w = Math.max(0, smoothed[jj - 1] - smoothed[jj]);
    weights[jj] = w;
    W += w;
  }
  if (W > 1e-18) {
    for (let jj = loIdx + 1; jj <= hiIdx; jj++) {
      deltaLoss[jj] += (L * weights[jj]) / W;
    }
  } else if (hiIdx >= 1) {
    deltaLoss[hiIdx] += L;
  }
}

/**
 * Stesso smoothing + hysteresis di `elevationGainLossSmoothed`, ma scompone
 * D+/D- sui passi tra campioni consecutivi (indici del profilo filtrato)
 * così da poter costruire cumulati interpolabili lungo i km.
 */
export function elevationSmoothedStepAllocations(
  elev: Array<number | null | undefined>,
  opts: { windowPts?: number; thresholdM?: number } = {}
): {
  origIndex: number[];
  filtered: number[];
  smoothed: number[];
  deltaGain: number[];
  deltaLoss: number[];
  gainTotal: number;
  lossTotal: number;
} | null {
  const windowPts = Math.max(1, opts.windowPts ?? ELEV_GAIN_DEFAULT_WINDOW_PTS);
  const thresholdM = Math.max(0, opts.thresholdM ?? ELEV_GAIN_DEFAULT_THRESHOLD_M);

  const filtered: number[] = [];
  const origIndex: number[] = [];
  for (let i = 0; i < elev.length; i++) {
    const e = elev[i];
    if (e == null || !Number.isFinite(e)) continue;
    filtered.push(e);
    origIndex.push(i);
  }
  if (filtered.length < 2) return null;

  const n = filtered.length;
  const smoothed = movingAverageElev(filtered, windowPts);
  const deltaGain = new Array<number>(n).fill(0);
  const deltaLoss = new Array<number>(n).fill(0);

  if (thresholdM <= 0) {
    let gainTotal = 0;
    let lossTotal = 0;
    for (let i = 1; i < n; i++) {
      const d = smoothed[i] - smoothed[i - 1];
      if (d > 0) {
        deltaGain[i] = d;
        gainTotal += d;
      } else {
        deltaLoss[i] = -d;
        lossTotal += -d;
      }
    }
    return {
      origIndex,
      filtered,
      smoothed,
      deltaGain,
      deltaLoss,
      gainTotal,
      lossTotal,
    };
  }

  let lastExtreme = smoothed[0];
  let candidate = smoothed[0];
  let lastExtremeIdx = 0;
  let candidateIdx = 0;
  let dir: 0 | 1 | -1 = 0;

  for (let i = 1; i < n; i++) {
    const e = smoothed[i];
    if (dir >= 0) {
      if (e > candidate) {
        candidate = e;
        candidateIdx = i;
      } else if (candidate - e >= thresholdM) {
        if (candidate > lastExtreme) {
          distributeGainOnSteps(
            candidate - lastExtreme,
            lastExtremeIdx,
            candidateIdx,
            smoothed,
            deltaGain
          );
        }
        lastExtreme = candidate;
        lastExtremeIdx = candidateIdx;
        dir = -1;
        candidate = e;
        candidateIdx = i;
      }
    }
    if (dir <= 0) {
      if (e < candidate) {
        candidate = e;
        candidateIdx = i;
      } else if (e - candidate >= thresholdM) {
        if (candidate < lastExtreme) {
          distributeLossOnSteps(
            lastExtreme - candidate,
            lastExtremeIdx,
            candidateIdx,
            smoothed,
            deltaLoss
          );
        }
        lastExtreme = candidate;
        lastExtremeIdx = candidateIdx;
        dir = 1;
        candidate = e;
        candidateIdx = i;
      }
    }
  }
  if (candidate > lastExtreme) {
    distributeGainOnSteps(
      candidate - lastExtreme,
      lastExtremeIdx,
      candidateIdx,
      smoothed,
      deltaGain
    );
  } else if (candidate < lastExtreme) {
    distributeLossOnSteps(
      lastExtreme - candidate,
      lastExtremeIdx,
      candidateIdx,
      smoothed,
      deltaLoss
    );
  }

  let gainTotal = 0;
  let lossTotal = 0;
  for (let i = 1; i < n; i++) {
    gainTotal += deltaGain[i];
    lossTotal += deltaLoss[i];
  }
  return {
    origIndex,
    filtered,
    smoothed,
    deltaGain,
    deltaLoss,
    gainTotal,
    lossTotal,
  };
}

/** Cumulati D+/D- per indice del profilo filtrato (stesso ordine di `elevationGainLossSmoothed`). */
export function cumulativeGainLossSmoothed(
  elev: Array<number | null | undefined>,
  opts?: { windowPts?: number; thresholdM?: number }
): { cumGain: number[]; cumLoss: number[] } | null {
  const alloc = elevationSmoothedStepAllocations(elev, opts ?? {});
  if (!alloc) return null;
  const n = alloc.filtered.length;
  const cumGain = new Array<number>(n);
  const cumLoss = new Array<number>(n);
  cumGain[0] = 0;
  cumLoss[0] = 0;
  for (let i = 1; i < n; i++) {
    cumGain[i] = cumGain[i - 1] + alloc.deltaGain[i];
    cumLoss[i] = cumLoss[i - 1] + alloc.deltaLoss[i];
  }
  return { cumGain, cumLoss };
}

/**
 * D+/D- stile ITRA: media mobile centrata (finestra in punti) sulle quote
 * + hysteresis threshold sui Δ (ignora oscillazioni < thresholdM).
 * Usare sulle quote RAW (prima di semplificazioni DP) per valori allineati
 * ai dislivelli "ufficiali" (Strava/Komoot/RideWithGPS).
 */
export function elevationGainLossSmoothed(
  elev: Array<number | null | undefined>,
  opts: { windowPts?: number; thresholdM?: number } = {}
): { gain: number; loss: number } {
  const alloc = elevationSmoothedStepAllocations(elev, opts);
  if (!alloc) return { gain: 0, loss: 0 };
  return { gain: alloc.gainTotal, loss: alloc.lossTotal };
}
