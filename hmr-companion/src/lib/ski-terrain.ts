/**
 * Terreno valanghivo lungo una traccia di scialpinismo, dal DEM.
 *
 * - Pendenza ed esposizione del VERSANTE (non della traccia) in ogni punto,
 *   dal gradiente del DEM: un traverso a mezza costa su un pendio di 38° è
 *   terreno da valanga anche se la traccia sale piano.
 * - Rosa delle esposizioni e classi di pendenza (come PeakVisor / FATMAP).
 * - Indicatore di rischio per tratto a tre colori (idea di Skitourenguru),
 *   con un calcolo ispirato al metodo di riduzione di Munter:
 *   potenziale 2^grado del bollettino ÷ fattori di riduzione per pendenza
 *   ed esposizione. È un aiuto alla pianificazione, non una valutazione.
 *
 * Funzioni pure: il campionatore di quote arriva da fuori.
 */

import type { Aspect } from "@/lib/avalanche-caaml";

export type Sampler = (lng: number, lat: number) => number | null;

export const SLOPE_CLASSES = [
  { max: 25, label: "< 25°", color: "#94a3b8" },
  { max: 30, label: "25–30°", color: "#facc15" },
  { max: 35, label: "30–35°", color: "#fb923c" },
  { max: 40, label: "35–40°", color: "#ef4444" },
  { max: 90, label: "> 40°", color: "#a21caf" },
] as const;

export const ASPECT_ORDER: Aspect[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const ASPECT_IT: Record<Aspect, string> = { N: "N", NE: "NE", E: "E", SE: "SE", S: "S", SW: "SO", W: "O", NW: "NO" };

export type TerrainPoint = {
  lng: number;
  lat: number;
  km: number;
  ele: number | null;
  /** Pendenza massima del versante nell'intorno (gradi). */
  slope: number | null;
  aspect: Aspect | null;
};

export type BulletinRating = { level: number | null; lower: number | null; upper: number | null; aspects: Aspect[] };
export type BulletinProblem = { aspects: Aspect[]; lower: number | null; upper: number | null };
export type BulletinInput = { ratings: BulletinRating[]; problems: BulletinProblem[]; maxDanger: number | null };

export type RiskLevel = "low" | "elevated" | "high";
export const RISK_COLORS: Record<RiskLevel, string> = { low: "#16a34a", elevated: "#f59e0b", high: "#dc2626" };
export const RISK_LABELS: Record<RiskLevel, string> = { low: "basso", elevated: "elevato", high: "alto" };

const M_PER_DEG_LAT = 111_320;

function offset(lng: number, lat: number, dx: number, dy: number): [number, number] {
  return [lng + dx / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)), lat + dy / M_PER_DEG_LAT];
}

/** Pendenza (gradi) ed esposizione del versante in un punto: differenze centrali su ±h metri. */
export function slopeAspectAt(sample: Sampler, lng: number, lat: number, h = 25): { slope: number; aspect: Aspect } | null {
  const e = sample(...offset(lng, lat, h, 0));
  const w = sample(...offset(lng, lat, -h, 0));
  const n = sample(...offset(lng, lat, 0, h));
  const s = sample(...offset(lng, lat, 0, -h));
  if (e == null || w == null || n == null || s == null) return null;
  const dzdx = (e - w) / (2 * h);
  const dzdy = (n - s) / (2 * h);
  const slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  // Il versante "guarda" verso la discesa: direzione opposta al gradiente.
  const az = ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360;
  return { slope, aspect: ASPECT_ORDER[Math.round(az / 45) % 8] };
}

function distM(a: [number, number], b: [number, number]): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * M_PER_DEG_LAT;
}

/** Ricampiona la traccia ogni `step` metri e analizza il versante in ogni punto. */
export function analyzeTrack(sample: Sampler, coords: [number, number][], step = 30): TerrainPoint[] {
  if (coords.length < 2) return [];
  const pts: { lng: number; lat: number; km: number }[] = [{ lng: coords[0][0], lat: coords[0][1], km: 0 }];
  let total = 0;
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const d = distM(a, b);
    let pos = step - carry;
    while (pos <= d) {
      const t = pos / d;
      pts.push({ lng: a[0] + t * (b[0] - a[0]), lat: a[1] + t * (b[1] - a[1]), km: (total + pos) / 1000 });
      pos += step;
    }
    carry = d - (pos - step);
    total += d;
  }
  const last = coords[coords.length - 1];
  pts.push({ lng: last[0], lat: last[1], km: total / 1000 });
  const raw = pts.map((p) => ({ ...p, ele: sample(p.lng, p.lat), sa: slopeAspectAt(sample, p.lng, p.lat) }));
  // Pendenza "del pendio": massimo nell'intorno di ±2 campioni (~60 m), come farebbe un occhio esperto.
  return raw.map((p, i) => {
    let maxSlope: number | null = null;
    for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) {
      const s = raw[j].sa?.slope;
      if (s != null && (maxSlope == null || s > maxSlope)) maxSlope = s;
    }
    return { lng: p.lng, lat: p.lat, km: p.km, ele: p.ele, slope: maxSlope, aspect: p.sa?.aspect ?? null };
  });
}

export type TerrainSummary = {
  length_km: number;
  /** km per classe di pendenza (indice come SLOPE_CLASSES). */
  slope_km: number[];
  /** km di terreno ≥ 30° per esposizione. */
  aspect_km_steep: Record<Aspect, number>;
  /** km totali per esposizione (qualsiasi pendenza ≥ 15°). */
  aspect_km: Record<Aspect, number>;
  max_slope: number | null;
};

export function summarizeTerrain(points: TerrainPoint[]): TerrainSummary {
  const slope_km = SLOPE_CLASSES.map(() => 0);
  const zero = () => Object.fromEntries(ASPECT_ORDER.map((a) => [a, 0])) as Record<Aspect, number>;
  const aspect_km = zero();
  const aspect_km_steep = zero();
  let max: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const seg = p.km - points[i - 1].km;
    if (p.slope == null) continue;
    max = max == null ? p.slope : Math.max(max, p.slope);
    const c = SLOPE_CLASSES.findIndex((k) => p.slope! < k.max);
    slope_km[c < 0 ? SLOPE_CLASSES.length - 1 : c] += seg;
    if (p.aspect && p.slope >= 15) aspect_km[p.aspect] += seg;
    if (p.aspect && p.slope >= 30) aspect_km_steep[p.aspect] += seg;
  }
  return {
    length_km: points.length ? points[points.length - 1].km : 0,
    slope_km,
    aspect_km,
    aspect_km_steep,
    max_slope: max == null ? null : Math.round(max),
  };
}

/** Quota di un limite del bollettino ("2200", "treeline" ≈ 2000 m). */
export function parseBandElevation(raw: string | null | undefined): number | null {
  if (!raw) return null;
  if (/treeline/i.test(raw)) return 2000;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function inBand(ele: number | null, lower: number | null, upper: number | null): boolean {
  if (ele == null) return true;
  return (lower == null || ele >= lower) && (upper == null || ele < upper);
}

/** Grado di pericolo che il bollettino assegna a quella quota ed esposizione. */
export function dangerAt(b: BulletinInput, ele: number | null, aspect: Aspect | null): number | null {
  let best: number | null = null;
  for (const r of b.ratings) {
    if (r.level == null || !inBand(ele, r.lower, r.upper)) continue;
    if (r.aspects.length && aspect && !r.aspects.includes(aspect)) continue;
    best = best == null ? r.level : Math.max(best, r.level);
  }
  return best ?? b.maxDanger;
}

/** Il punto ricade in un problema valanghivo (esposizione + quota) del bollettino? */
export function inProblemZone(b: BulletinInput, ele: number | null, aspect: Aspect | null): boolean {
  if (!b.problems.length) return true; // senza dettaglio: prudenza, nessuna riduzione
  return b.problems.some(
    (p) => inBand(ele, p.lower, p.upper) && (!p.aspects.length || (aspect != null && p.aspects.includes(aspect))),
  );
}

/** Fattore di riduzione per la pendenza del pendio (≥ 40° nessuna riduzione). */
export function slopeReduction(slope: number): number {
  if (slope >= 40) return 1;
  if (slope >= 35) return 2;
  if (slope >= 30) return 3;
  return 8; // sotto i 30° i distacchi spontanei/provocati sono rari
}

export function riskScore(b: BulletinInput, p: Pick<TerrainPoint, "slope" | "aspect" | "ele">): number | null {
  if (p.slope == null) return null;
  const level = dangerAt(b, p.ele, p.aspect);
  if (level == null) return null;
  const potential = 2 ** level;
  const aspectRf = inProblemZone(b, p.ele, p.aspect) ? 1 : 2;
  return potential / (slopeReduction(p.slope) * aspectRf);
}

export function riskLevel(score: number): RiskLevel {
  return score <= 1 ? "low" : score <= 2 ? "elevated" : "high";
}

export type RiskSection = { level: RiskLevel; kmStart: number; kmEnd: number; coordinates: [number, number][]; maxSlope: number };

/** Tratti contigui dello stesso livello di rischio (per colorare la traccia sulla mappa). */
export function riskSections(b: BulletinInput, points: TerrainPoint[]): RiskSection[] {
  const out: RiskSection[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const s = riskScore(b, p);
    const level: RiskLevel = s == null ? "low" : riskLevel(s);
    const cur = out[out.length - 1];
    const coord: [number, number] = [p.lng, p.lat];
    if (cur && cur.level === level) {
      cur.coordinates.push(coord);
      cur.kmEnd = p.km;
      cur.maxSlope = Math.max(cur.maxSlope, p.slope ?? 0);
    } else {
      // Il nuovo tratto parte dall'ultimo punto del precedente: linea continua.
      const start = cur ? [cur.coordinates[cur.coordinates.length - 1], coord] : [coord];
      out.push({ level, kmStart: cur ? cur.kmEnd : p.km, kmEnd: p.km, coordinates: start as [number, number][], maxSlope: p.slope ?? 0 });
    }
  }
  return out.filter((s) => s.coordinates.length >= 2);
}

/** Livello complessivo: il peggiore fra i tratti lunghi almeno 60 m (i singoli campioni sono rumore). */
export function overallRisk(sections: RiskSection[]): RiskLevel {
  const rank: Record<RiskLevel, number> = { low: 0, elevated: 1, high: 2 };
  let worst: RiskLevel = "low";
  for (const s of sections) {
    if (s.kmEnd - s.kmStart >= 0.06 && rank[s.level] > rank[worst]) worst = s.level;
  }
  return worst;
}
