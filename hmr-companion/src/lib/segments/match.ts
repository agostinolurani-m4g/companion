/**
 * Abbinamento traccia ↔ segmento (stile Strava).
 *
 * Un'attività "passa" sul segmento quando: tocca la partenza (entro
 * START_RADIUS_M), poi l'arrivo (entro END_RADIUS_M), e nel mezzo segue il
 * segmento (ogni campione del segmento entro FOLLOW_RADIUS_M dal tratto
 * percorso). Il tempo è la differenza degli orari interpolati sui due punti
 * di passaggio. Funzioni pure: nessun DB, testabili.
 */

export const START_RADIUS_M = 35;
export const END_RADIUS_M = 35;
export const FOLLOW_RADIUS_M = 45;
/** Quota dei campioni del segmento che devono stare vicino alla traccia. */
export const FOLLOW_MIN_SHARE = 0.9;
const SAMPLE_STEP_M = 40;

type XY = [number, number];

export type SegmentEffortMatch = {
  /** Indice frazionario sulla traccia dell'attività (inizio / fine passaggio). */
  start_f: number;
  end_f: number;
  /** Secondi dalla partenza dell'attività al passaggio sul via (null senza orari). */
  start_offset_s: number | null;
  /** Tempo sul segmento in secondi (null senza orari). */
  elapsed_s: number | null;
  /** Distanza percorsa dall'attività sul segmento (m). */
  distance_m: number;
};

/** Proiezione equirettangolare locale in metri: sufficiente su distanze di pochi km. */
function projector(lat0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  const M = 111_320;
  return (lng: number, lat: number): XY => [lng * M * k, lat * M];
}

function dist(a: XY, b: XY): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Distanza punto-segmento e parametro t ∈ [0,1] della proiezione. */
function pointToEdge(p: XY, a: XY, b: XY): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t };
}

export function lineLengthM(coords: GeoJSON.Position[]): number {
  if (coords.length < 2) return 0;
  const proj = projector(coords[0][1]);
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += dist(proj(coords[i - 1][0], coords[i - 1][1]), proj(coords[i][0], coords[i][1]));
  return s;
}

/** Campioni ogni ~40 m lungo il segmento (estremi inclusi). */
function sampleLine(pts: XY[]): XY[] {
  const out: XY[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = dist(a, b);
    let pos = SAMPLE_STEP_M - carry;
    while (pos < d) {
      const t = pos / d;
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      pos += SAMPLE_STEP_M;
    }
    carry = d - (pos - SAMPLE_STEP_M);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Passaggi vicino a un punto: per ogni "avvicinamento" sotto soglia restituisce
 * l'indice frazionario del punto più vicino della traccia.
 */
function passes(track: XY[], p: XY, radius: number): number[] {
  const out: number[] = [];
  let best: { d: number; f: number } | null = null;
  for (let i = 0; i < track.length - 1; i++) {
    const { d, t } = pointToEdge(p, track[i], track[i + 1]);
    if (d <= radius) {
      if (!best || d < best.d) best = { d, f: i + t };
    } else if (best) {
      out.push(best.f);
      best = null;
    }
  }
  if (best) out.push(best.f);
  return out;
}

function pointAt(track: XY[], f: number): XY {
  const i = Math.min(track.length - 2, Math.max(0, Math.floor(f)));
  const t = Math.min(1, Math.max(0, f - i));
  const a = track[i];
  const b = track[i + 1];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

function valueAt(values: number[], f: number): number {
  const i = Math.min(values.length - 2, Math.max(0, Math.floor(f)));
  const t = Math.min(1, Math.max(0, f - i));
  return values[i] + t * (values[i + 1] - values[i]);
}

/** Sotto-traccia fra due indici frazionari (estremi interpolati). */
function subTrack(track: XY[], fa: number, fb: number): XY[] {
  const out: XY[] = [pointAt(track, fa)];
  for (let i = Math.ceil(fa); i <= Math.floor(fb); i++) out.push(track[i]);
  out.push(pointAt(track, fb));
  return out;
}

function polyLen(pts: XY[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** Il tratto percorso segue il segmento (quasi tutti i campioni vicini, in ordine)? */
function follows(sub: XY[], samples: XY[]): boolean {
  let near = 0;
  let lastEdge = 0;
  let ordered = 0;
  for (const s of samples) {
    let bestD = Infinity;
    let bestEdge = 0;
    for (let i = 0; i < sub.length - 1; i++) {
      const { d } = pointToEdge(s, sub[i], sub[i + 1]);
      if (d < bestD) {
        bestD = d;
        bestEdge = i;
      }
    }
    if (bestD <= FOLLOW_RADIUS_M) {
      near++;
      if (bestEdge >= lastEdge) ordered++;
      lastEdge = Math.max(lastEdge, bestEdge);
    }
  }
  return near / samples.length >= FOLLOW_MIN_SHARE && ordered / Math.max(1, near) >= 0.8;
}

/**
 * Tutti i passaggi di un'attività su un segmento.
 * `times[i]`: secondi dalla partenza del vertice i dell'attività, o null.
 */
export function matchSegment(
  segment: GeoJSON.Position[],
  activity: GeoJSON.Position[],
  times: number[] | null,
): SegmentEffortMatch[] {
  if (segment.length < 2 || activity.length < 2) return [];
  const proj = projector(segment[0][1]);
  const seg = segment.map((c) => proj(c[0], c[1]));
  const track = activity.map((c) => proj(c[0], c[1]));
  const segLen = polyLen(seg);
  if (segLen < 50) return [];
  const samples = sampleLine(seg);
  const starts = passes(track, seg[0], START_RADIUS_M);
  if (!starts.length) return [];
  const ends = passes(track, seg[seg.length - 1], END_RADIUS_M);
  if (!ends.length) return [];
  const useTimes = times && times.length === activity.length ? times : null;

  const out: SegmentEffortMatch[] = [];
  let after = -1;
  for (const fs of starts) {
    if (fs <= after) continue;
    for (const fe of ends) {
      if (fe <= fs) continue;
      const sub = subTrack(track, fs, fe);
      const len = polyLen(sub);
      if (len < segLen * 0.75) continue;
      // Troppo lunga: l'attività ha fatto altro in mezzo; un arrivo successivo lo sarà ancora di più.
      if (len > segLen * 1.6 + 200) break;
      if (!follows(sub, samples)) continue;
      out.push({
        start_f: fs,
        end_f: fe,
        start_offset_s: useTimes ? Math.round(valueAt(useTimes, fs)) : null,
        elapsed_s: useTimes ? Math.max(1, Math.round(valueAt(useTimes, fe) - valueAt(useTimes, fs))) : null,
        distance_m: Math.round(len),
      });
      after = fe;
      break;
    }
  }
  return out;
}

export type SegmentStats = {
  length_m: number;
  elev_gain_m: number;
  elev_loss_m: number;
  avg_grade_pct: number;
  max_grade_pct: number;
  min_ele: number | null;
  max_ele: number | null;
};

/** Statistiche del segmento (pendenza media/massima su finestre di 100 m). */
export function segmentStats(coords: GeoJSON.Position[]): SegmentStats {
  const proj = projector(coords[0][1]);
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + dist(proj(coords[i - 1][0], coords[i - 1][1]), proj(coords[i][0], coords[i][1])));
  }
  const length_m = cum[cum.length - 1];
  const eles = coords.map((c) => (c.length > 2 && Number.isFinite(c[2]) ? (c[2] as number) : null));
  let gain = 0;
  let loss = 0;
  let maxGrade = 0;
  let minE: number | null = null;
  let maxE: number | null = null;
  let ref: number | null = null;
  for (let i = 0; i < coords.length; i++) {
    const e = eles[i];
    if (e == null) continue;
    minE = minE == null ? e : Math.min(minE, e);
    maxE = maxE == null ? e : Math.max(maxE, e);
    if (ref == null) ref = e;
    else if (e - ref >= 3) {
      gain += e - ref;
      ref = e;
    } else if (ref - e >= 3) {
      loss += ref - e;
      ref = e;
    }
    // Pendenza massima su 100 m: cerca all'indietro il punto ~100 m prima.
    let j = i;
    while (j > 0 && cum[i] - cum[j] < 100) j--;
    const ej = eles[j];
    if (ej != null && cum[i] - cum[j] >= 80) maxGrade = Math.max(maxGrade, Math.abs(((e - ej) / (cum[i] - cum[j])) * 100));
  }
  const first = eles.find((e) => e != null) ?? null;
  const last = [...eles].reverse().find((e) => e != null) ?? null;
  const net = first != null && last != null ? last - first : 0;
  return {
    length_m: Math.round(length_m),
    elev_gain_m: Math.round(gain),
    elev_loss_m: Math.round(loss),
    avg_grade_pct: length_m > 0 ? Math.round((net / length_m) * 1000) / 10 : 0,
    max_grade_pct: Math.round(maxGrade * 10) / 10,
    min_ele: minE,
    max_ele: maxE,
  };
}

export type ClimbSuggestion = { start: number; end: number; gain_m: number; length_m: number; avg_grade_pct: number };

/**
 * Salite candidate a segmento lungo una traccia: tratti con almeno `minGain`
 * metri di dislivello a pendenza media ≥ `minGrade`%. Indici sui vertici.
 */
export function detectClimbs(
  coords: GeoJSON.Position[],
  opts: { minGain?: number; minGrade?: number } = {},
): ClimbSuggestion[] {
  const minGain = opts.minGain ?? 60;
  const minGrade = opts.minGrade ?? 4;
  if (coords.length < 3) return [];
  const proj = projector(coords[0][1]);
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + dist(proj(coords[i - 1][0], coords[i - 1][1]), proj(coords[i][0], coords[i][1])));
  }
  const ele = coords.map((c) => (c.length > 2 && Number.isFinite(c[2]) ? (c[2] as number) : NaN));
  if (ele.filter(Number.isFinite).length < coords.length * 0.8) return [];
  const out: ClimbSuggestion[] = [];
  let i = 0;
  while (i < coords.length - 1) {
    if (!Number.isFinite(ele[i])) {
      i++;
      continue;
    }
    // Da un minimo locale sali finché la discesa dal massimo non supera 25 m.
    let top = i;
    let j = i + 1;
    while (j < coords.length) {
      if (!Number.isFinite(ele[j])) {
        j++;
        continue;
      }
      if (ele[j] > ele[top]) top = j;
      if (ele[top] - ele[j] > 25) break;
      j++;
    }
    const gain = ele[top] - ele[i];
    const len = cum[top] - cum[i];
    if (top > i && gain >= minGain && len > 0 && (gain / len) * 100 >= minGrade) {
      out.push({
        start: i,
        end: top,
        gain_m: Math.round(gain),
        length_m: Math.round(len),
        avg_grade_pct: Math.round((gain / len) * 1000) / 10,
      });
      i = top;
    } else {
      // Avanza fino al prossimo minimo locale.
      let k = i + 1;
      while (k < coords.length - 1 && !(ele[k] <= ele[k - 1] && ele[k] <= ele[k + 1])) k++;
      i = Math.max(k, i + 1);
    }
  }
  return out;
}

/** Discese candidate (MTB, sci): come le salite ma sulla quota rovesciata. */
export function detectDescents(
  coords: GeoJSON.Position[],
  opts: { minGain?: number; minGrade?: number } = {},
): ClimbSuggestion[] {
  const flipped = coords.map((c) => (c.length > 2 && Number.isFinite(c[2]) ? [c[0], c[1], -(c[2] as number)] : c));
  return detectClimbs(flipped, { minGain: opts.minGain ?? 80, minGrade: opts.minGrade ?? 6 });
}

export type SegmentKind = "climb" | "descent" | "flat";

/** Tipo di segmento dal profilo: salita/discesa se il dislivello netto supera il 2% della lunghezza. */
export function segmentKind(st: Pick<SegmentStats, "length_m" | "avg_grade_pct">): SegmentKind {
  if (st.avg_grade_pct >= 2) return "climb";
  if (st.avg_grade_pct <= -2) return "descent";
  return "flat";
}
