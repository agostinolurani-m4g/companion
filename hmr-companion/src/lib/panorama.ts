/**
 * Panorama delle vette (stile PeakFinder), calcolato dal DEM senza fotocamera.
 *
 * Per ogni azimut si cammina lontano dall'osservatore e si tiene l'angolo di
 * elevazione massimo visto finora (curvatura terrestre e rifrazione incluse):
 * è la linea dell'orizzonte. Una vetta è visibile se il suo angolo non è
 * coperto dal terreno più vicino nella stessa direzione. Funzioni pure: il
 * campionatore di quote arriva da fuori (tile DEM nel browser, finto nei test).
 */

export type ElevationSampler = (lng: number, lat: number) => number | null;

export type PanoramaPeak = { id: string; name: string; lat: number; lng: number; ele: number | null };

export type VisiblePeak = PanoramaPeak & {
  azimuth: number;
  distance_m: number;
  angle: number;
  ele_used: number;
};

/** Fasce di distanza disegnate come creste a tono diverso (vicino scuro → lontano chiaro). */
export const RIDGE_BANDS_M = [3_000, 10_000, 25_000, 60_000, Infinity] as const;

export type Panorama = {
  observer: { lng: number; lat: number; ele: number };
  stepDeg: number;
  /** Angolo (gradi) dell'orizzonte per azimut: lunghezza 360/stepDeg. */
  horizon: Float32Array;
  /** Per fascia: angolo massimo del terreno nella fascia (NaN se coperto da fasce più vicine). */
  ridges: Float32Array[];
  peaks: VisiblePeak[];
  maxDistanceM: number;
};

const R_EARTH = 6_371_000;
/** Coefficiente di rifrazione atmosferica standard. */
const K_REFRACTION = 0.13;

function curvatureDrop(d: number): number {
  return ((d * d) / (2 * R_EARTH)) * (1 - K_REFRACTION);
}

function elevationAngleDeg(h0: number, e: number, d: number): number {
  return (Math.atan2(e - curvatureDrop(d) - h0, d) * 180) / Math.PI;
}

function destination(lng: number, lat: number, azDeg: number, d: number): [number, number] {
  const az = (azDeg * Math.PI) / 180;
  const dLat = (d * Math.cos(az)) / 111_320;
  const dLng = (d * Math.sin(az)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lng + dLng, lat + dLat];
}

export function bearingDeg(lng0: number, lat0: number, lng1: number, lat1: number): number {
  const k = Math.cos((lat0 * Math.PI) / 180);
  const dx = (lng1 - lng0) * k;
  const dy = lat1 - lat0;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

export function distanceM(lng0: number, lat0: number, lng1: number, lat1: number): number {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return Math.hypot((lng1 - lng0) * k, lat1 - lat0) * 111_320;
}

/** Distanze di campionamento: fitte vicino, rade lontano (crescita geometrica). */
export function sampleDistances(maxM: number): number[] {
  const out: number[] = [];
  for (let d = 40; d <= maxM; d = Math.max(d + 30, d * 1.018)) out.push(d);
  return out;
}

export function computePanorama(
  sample: ElevationSampler,
  observer: { lng: number; lat: number },
  peaks: PanoramaPeak[],
  opts: { maxDistanceM?: number; stepDeg?: number; eyeHeightM?: number; observerEle?: number } = {},
): Panorama | null {
  const maxD = opts.maxDistanceM ?? 80_000;
  const step = opts.stepDeg ?? 0.5;
  const ground = opts.observerEle ?? sample(observer.lng, observer.lat);
  if (ground == null) return null;
  const h0 = ground + (opts.eyeHeightM ?? 2);
  const n = Math.round(360 / step);
  const dists = sampleDistances(maxD);
  const horizon = new Float32Array(n).fill(-90);
  const ridges = RIDGE_BANDS_M.map(() => new Float32Array(n).fill(Number.NaN));
  // Massimo cumulato per azimut e passo: serve per l'occlusione delle vette.
  const cum = new Float32Array(n * dists.length);

  for (let i = 0; i < n; i++) {
    const az = i * step;
    let max = -90;
    let band = 0;
    let bandMax = -90;
    for (let j = 0; j < dists.length; j++) {
      const d = dists[j];
      while (d > RIDGE_BANDS_M[band]) {
        if (bandMax > -90) ridges[band][i] = bandMax;
        band++;
        bandMax = -90;
      }
      const [lng, lat] = destination(observer.lng, observer.lat, az, d);
      const e = sample(lng, lat);
      if (e != null) {
        const a = elevationAngleDeg(h0, e, d);
        // Cresta della fascia solo dove spunta sopra tutto ciò che è più vicino.
        if (a > max) {
          if (a > bandMax) bandMax = a;
          max = a;
        }
      }
      cum[i * dists.length + j] = max;
    }
    if (bandMax > -90) ridges[band][i] = bandMax;
    horizon[i] = max;
  }

  const visible: VisiblePeak[] = [];
  for (const p of peaks) {
    const d = distanceM(observer.lng, observer.lat, p.lng, p.lat);
    if (d < 150 || d > maxD) continue;
    const az = bearingDeg(observer.lng, observer.lat, p.lng, p.lat);
    const dem = sample(p.lng, p.lat);
    // La quota OSM è spesso più precisa del DEM (che smussa le cime); il DEM copre i buchi.
    const e = p.ele ?? dem;
    if (e == null) continue;
    const angle = elevationAngleDeg(h0, e, d);
    // Terreno fra osservatore e vetta (escluso l'intorno della cima, dove il DEM è la vetta stessa).
    const before = Math.max(0, d - Math.max(300, d * 0.03));
    let jMax = -1;
    while (jMax + 1 < dists.length && dists[jMax + 1] <= before) jMax++;
    let occl = -90;
    if (jMax >= 0) {
      const i0 = Math.round(az / step) % n;
      // Azimut vicini: la vetta ha larghezza angolare, evita falsi "nascosti" per un campione.
      occl = Math.min(cum[i0 * dists.length + jMax], cum[((i0 + 1) % n) * dists.length + jMax], cum[((i0 - 1 + n) % n) * dists.length + jMax]);
    }
    if (angle + 0.08 >= occl) visible.push({ ...p, azimuth: az, distance_m: Math.round(d), angle, ele_used: Math.round(e) });
  }
  visible.sort((a, b) => a.azimuth - b.azimuth);
  return { observer: { lng: observer.lng, lat: observer.lat, ele: Math.round(ground) }, stepDeg: step, horizon, ridges, peaks: visible, maxDistanceM: maxD };
}

/**
 * Sceglie quali etichette mostrare senza sovrapposizioni: priorità alle vette
 * più "importanti" (alte sopra l'orizzonte locale e vicine), una ogni `minGapDeg`.
 */
export function declutterPeaks(peaks: VisiblePeak[], minGapDeg: number, max = 80): VisiblePeak[] {
  const score = (p: VisiblePeak) => p.ele_used / 100 + p.angle * 4 - p.distance_m / 20_000;
  const chosen: VisiblePeak[] = [];
  for (const p of [...peaks].sort((a, b) => score(b) - score(a))) {
    if (chosen.length >= max) break;
    const clash = chosen.some((c) => {
      const d = Math.abs(c.azimuth - p.azimuth);
      return Math.min(d, 360 - d) < minGapDeg;
    });
    if (!clash) chosen.push(p);
  }
  return chosen.sort((a, b) => a.azimuth - b.azimuth);
}

export const COMPASS_LABELS: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SO", 270: "O", 315: "NO" };
