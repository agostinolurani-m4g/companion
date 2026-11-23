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
 * - Come Skitourenguru guarda anche il pendio intorno alla traccia:
 *   dimensione del pendio ripido (i pendii piccoli hanno conseguenze minori),
 *   forma (canali e conche sono trappole, le creste sono più sicure) e terreno
 *   ripido SOPRA la traccia, da cui una valanga può scendere fin lì.
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
  /** Area del pendio ≥ 30° collegato al punto (m²), solo dove il versante è ripido. */
  steepArea?: number | null;
  /** Forma del terreno nel punto. */
  shape?: TerrainShape | null;
  /** Pendio ripido a monte da cui una valanga può arrivare fin qui. */
  above?: AboveTerrain | null;
};

export type TerrainShape = "gully" | "ridge" | "planar";
export const SHAPE_LABELS: Record<TerrainShape, string> = { gully: "canale o conca", ridge: "cresta o dosso", planar: "pendio aperto" };

export type AboveTerrain = {
  /** Pendenza massima del pendio a monte (gradi). */
  slope: number;
  /** Angolo dal punto alla zona di distacco: oltre ~22° la valanga può arrivare. */
  angle: number;
  /** Distanza orizzontale dalla zona di distacco (m). */
  distance: number;
  /** Dislivello fino alla zona di distacco (m). */
  drop: number;
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

/** Soglia di pendenza delle zone di distacco. */
export const RELEASE_SLOPE = 30;
/** Angolo minimo dal punto alla zona di distacco perché la valanga possa arrivare (runout prudente). */
export const RUNOUT_ANGLE = 22;
/** Sotto quest'area il pendio è "piccolo": conseguenze limitate. */
export const SMALL_SLOPE_M2 = 4_000;

const AREA_STEP = 25;
const AREA_RADIUS = 250;

/** Pendenza con cache su griglia di 5 m (i calcoli di contesto rileggono gli stessi punti). */
function cachedSlope(sample: Sampler, cache: Map<string, number | null>) {
  return (lng: number, lat: number): number | null => {
    const k = `${lng.toFixed(5)},${lat.toFixed(5)}`;
    if (cache.has(k)) return cache.get(k)!;
    const v = slopeAspectAt(sample, lng, lat)?.slope ?? null;
    cache.set(k, v);
    return v;
  };
}

/**
 * Area del pendio ≥ 30° collegato al punto: riempimento su una griglia di 25 m
 * entro 250 m, partendo dalla cella ripida più vicina.
 */
export function steepAreaAt(slopeAt: (lng: number, lat: number) => number | null, lng: number, lat: number): number {
  const n = Math.round(AREA_RADIUS / AREA_STEP);
  const size = 2 * n + 1;
  const steep = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const [x, y] = offset(lng, lat, (i - n) * AREA_STEP, (j - n) * AREA_STEP);
      const s = slopeAt(x, y);
      steep[j * size + i] = s != null && s >= RELEASE_SLOPE ? 1 : 0;
    }
  }
  // Seme: la cella ripida più vicina al centro (entro 2 celle).
  let seed = -1;
  let best = Infinity;
  for (let dj = -2; dj <= 2; dj++) {
    for (let di = -2; di <= 2; di++) {
      const idx = (n + dj) * size + (n + di);
      if (steep[idx] && di * di + dj * dj < best) {
        best = di * di + dj * dj;
        seed = idx;
      }
    }
  }
  if (seed < 0) return 0;
  const seen = new Uint8Array(size * size);
  const stack = [seed];
  seen[seed] = 1;
  let count = 0;
  while (stack.length) {
    const c = stack.pop()!;
    count++;
    const ci = c % size;
    const cj = Math.floor(c / size);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= size || j >= size) continue;
      const k = j * size + i;
      if (!seen[k] && steep[k]) {
        seen[k] = 1;
        stack.push(k);
      }
    }
  }
  return count * AREA_STEP * AREA_STEP;
}

/**
 * Forma del terreno: quota del punto rispetto alla media di 8 punti a 60 m.
 * Più basso della media di oltre 4 m = canale/conca (trappola), più alto = cresta/dosso.
 */
export function shapeAt(sample: Sampler, lng: number, lat: number, r = 60): TerrainShape | null {
  const c = sample(lng, lat);
  if (c == null) return null;
  let sum = 0;
  let k = 0;
  for (let a = 0; a < 360; a += 45) {
    const rad = (a * Math.PI) / 180;
    const e = sample(...offset(lng, lat, r * Math.sin(rad), r * Math.cos(rad)));
    if (e == null) return null;
    sum += e;
    k++;
  }
  const d = sum / k - c;
  return d > 4 ? "gully" : d < -4 ? "ridge" : "planar";
}

/**
 * Terreno ripido a monte: scansione radiale in 16 direzioni fino a 500 m.
 * Se si trova un pendio ≥ 30° visto dal punto con un angolo ≥ 22°, una valanga
 * staccata lì può arrivare fin qui (anche se la traccia è in piano).
 */
export function aboveTerrainAt(
  sample: Sampler,
  lng: number,
  lat: number,
  opts: { maxDist?: number; step?: number; slopeAt?: (lng: number, lat: number) => number | null } = {},
): AboveTerrain | null {
  const maxDist = opts.maxDist ?? 500;
  const step = opts.step ?? 25;
  const slopeAt = opts.slopeAt ?? ((x: number, y: number) => slopeAspectAt(sample, x, y, 15)?.slope ?? null);
  const e0 = sample(lng, lat);
  if (e0 == null) return null;
  let best: AboveTerrain | null = null;
  for (let a = 0; a < 360; a += 22.5) {
    const rad = (a * Math.PI) / 180;
    for (let d = step; d <= maxDist; d += step) {
      const [x, y] = offset(lng, lat, d * Math.sin(rad), d * Math.cos(rad));
      const ez = sample(x, y);
      if (ez == null) break;
      const drop = ez - e0;
      const angle = (Math.atan2(drop, d) * 180) / Math.PI;
      // Sotto l'angolo di scorrimento più in là non può che peggiorare solo se il terreno sale ancora:
      // si continua, ma si valuta la pendenza solo dove l'angolo basta.
      if (angle < RUNOUT_ANGLE || drop < 20) continue;
      const slope = slopeAt(x, y);
      if (slope != null && slope >= RELEASE_SLOPE && (!best || slope > best.slope)) {
        best = { slope, angle, distance: d, drop };
      }
    }
  }
  return best;
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
  const slopeAt = cachedSlope(sample, new Map());
  // Pendenza "del pendio": massimo nell'intorno di ±2 campioni (~60 m), come farebbe un occhio esperto.
  return raw.map((p, i) => {
    let maxSlope: number | null = null;
    for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) {
      const s = raw[j].sa?.slope;
      if (s != null && (maxSlope == null || s > maxSlope)) maxSlope = s;
    }
    const steep = maxSlope != null && maxSlope >= RELEASE_SLOPE - 2;
    return {
      lng: p.lng,
      lat: p.lat,
      km: p.km,
      ele: p.ele,
      slope: maxSlope,
      aspect: p.sa?.aspect ?? null,
      steepArea: steep ? steepAreaAt(slopeAt, p.lng, p.lat) : null,
      shape: shapeAt(sample, p.lng, p.lat),
      above: aboveTerrainAt(sample, p.lng, p.lat, { slopeAt }),
    };
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
  /** km sotto un pendio ripido a monte (raggiungibili da una valanga). */
  exposed_above_km: number;
  /** km in canali o conche. */
  gully_km: number;
  /** Area massima di pendio ≥ 30° collegato alla traccia (m²). */
  max_steep_area: number;
};

export function summarizeTerrain(points: TerrainPoint[]): TerrainSummary {
  const slope_km = SLOPE_CLASSES.map(() => 0);
  const zero = () => Object.fromEntries(ASPECT_ORDER.map((a) => [a, 0])) as Record<Aspect, number>;
  const aspect_km = zero();
  const aspect_km_steep = zero();
  let max: number | null = null;
  let exposed = 0;
  let gully = 0;
  let maxArea = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const seg = p.km - points[i - 1].km;
    if (p.above && (p.slope == null || p.above.slope > p.slope)) exposed += seg;
    if (p.shape === "gully") gully += seg;
    if (p.steepArea) maxArea = Math.max(maxArea, p.steepArea);
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
    exposed_above_km: exposed,
    gully_km: gully,
    max_steep_area: maxArea,
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

/** Fattore per la dimensione del pendio: i pendii piccoli hanno conseguenze minori. */
export function sizeReduction(area: number | null | undefined): number {
  return area != null && area > 0 && area < SMALL_SLOPE_M2 ? 1.5 : 1;
}

/** Fattore per la forma: i canali accumulano neve e seppelliscono più a fondo; le creste sono più sicure. */
export function shapeReduction(shape: TerrainShape | null | undefined, exposedAbove: boolean): number {
  if (shape === "gully") return 0.75;
  if (shape === "ridge" && !exposedAbove) return 1.25;
  return 1;
}

/** Pendenza che conta nel punto: quella del versante o quella del pendio a monte che lo minaccia. */
export function effectiveSlope(p: Pick<TerrainPoint, "slope" | "above">): number | null {
  if (p.slope == null) return p.above ? p.above.slope : null;
  return p.above ? Math.max(p.slope, p.above.slope) : p.slope;
}

export function riskScore(
  b: BulletinInput,
  p: Pick<TerrainPoint, "slope" | "aspect" | "ele"> & Partial<Pick<TerrainPoint, "steepArea" | "shape" | "above">>,
): number | null {
  const slope = effectiveSlope({ slope: p.slope, above: p.above ?? null });
  if (slope == null) return null;
  const level = dangerAt(b, p.ele, p.aspect);
  if (level == null) return null;
  const potential = 2 ** level;
  const aspectRf = inProblemZone(b, p.ele, p.aspect) ? 1 : 2;
  const exposed = !!p.above && (p.slope == null || p.above.slope > p.slope);
  // Se la minaccia viene da sopra conta il pendio a monte, non quello piccolo sotto i piedi.
  const sizeRf = exposed ? 1 : sizeReduction(p.steepArea);
  return potential / (slopeReduction(slope) * aspectRf * sizeRf * shapeReduction(p.shape, exposed));
}

/** Motivi leggibili del rischio in un punto (per l'elenco dei tratti). */
export function riskReasons(p: TerrainPoint): string[] {
  const out: string[] = [];
  if (p.above && (p.slope == null || p.above.slope > p.slope)) {
    out.push(`pendio di ${Math.round(p.above.slope)}° a monte (${Math.round(p.above.drop)} m sopra)`);
  }
  if (p.shape === "gully") out.push("canale o conca");
  if (p.steepArea != null && p.steepArea > 0 && p.steepArea < SMALL_SLOPE_M2) out.push("pendio piccolo");
  else if (p.steepArea != null && p.steepArea >= 40_000) out.push("pendio grande");
  return out;
}

export function riskLevel(score: number): RiskLevel {
  return score <= 1 ? "low" : score <= 2 ? "elevated" : "high";
}

export type RiskSection = {
  level: RiskLevel;
  kmStart: number;
  kmEnd: number;
  coordinates: [number, number][];
  maxSlope: number;
  /** Motivi aggiuntivi (terreno a monte, canale, dimensione del pendio). */
  reasons: string[];
};

/** Tratti contigui dello stesso livello di rischio (per colorare la traccia sulla mappa). */
export function riskSections(b: BulletinInput, points: TerrainPoint[]): RiskSection[] {
  const out: RiskSection[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const s = riskScore(b, p);
    const level: RiskLevel = s == null ? "low" : riskLevel(s);
    const cur = out[out.length - 1];
    const coord: [number, number] = [p.lng, p.lat];
    const slope = effectiveSlope(p) ?? 0;
    const why = level === "low" ? [] : riskReasons(p);
    if (cur && cur.level === level) {
      cur.coordinates.push(coord);
      cur.kmEnd = p.km;
      cur.maxSlope = Math.max(cur.maxSlope, slope);
      for (const r of why) if (!cur.reasons.some((x) => x.split(" ")[0] === r.split(" ")[0])) cur.reasons.push(r);
    } else {
      // Il nuovo tratto parte dall'ultimo punto del precedente: linea continua.
      const start = cur ? [cur.coordinates[cur.coordinates.length - 1], coord] : [coord];
      out.push({ level, kmStart: cur ? cur.kmEnd : p.km, kmEnd: p.km, coordinates: start as [number, number][], maxSlope: slope, reasons: why });
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
