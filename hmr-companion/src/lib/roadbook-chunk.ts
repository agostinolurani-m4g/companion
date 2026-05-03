/**
 * Roadbook: statistiche per blocchi km lungo la traccia (on-demand, no tabella DB).
 */

import type {
  CheckpointRow,
  NotableSectionRow,
  PoiCategory,
  PoiRow,
  RacePlanItemRow,
  ResupplyRow,
} from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import { surfaceKindAtKm, type SurfaceKmSpan, type TrackSurfaceKind } from "@/lib/surface-osm";

export const ROADBOOK_SCHEMA_VERSION = 1;

/** Soglia pendenza % su non-asfalto → probabile a piedi. */
export const STEEP_UNPAVED_GRADE_PCT = 15;

/** Ignora segmenti troppo corti (rumore GPX). */
export const STEEP_MIN_HORIZONTAL_M = 40;

export type RoadbookSurfaceKm = {
  asphalt: number;
  gravel: number;
  single: number;
  unknown: number;
};

export type RoadbookSurfacePct = {
  asphalt: number;
  gravel: number;
  single: number;
  unknown: number;
};

export type RoadbookPoiHighlight = {
  category: PoiCategory;
  name: string | null;
  along_km: number;
  detour_m: number;
};

export type RoadbookSteepSpan = {
  km_start: number;
  km_end: number;
  grade_pct_max: number;
};

export type RoadbookChunk = {
  schema_version: typeof ROADBOOK_SCHEMA_VERSION;
  chunk_index: number;
  km_start: number;
  km_end: number;
  surface_km: RoadbookSurfaceKm;
  surface_pct: RoadbookSurfacePct;
  surface_low_confidence: boolean;
  elev_min_m: number | null;
  elev_max_m: number | null;
  elev_gain_m_approx: number | null;
  elev_loss_m_approx: number | null;
  count_water: number;
  count_food: number;
  count_lodging: number;
  count_pharmacy: number;
  has_checkpoint: boolean;
  has_official_resupply: boolean;
  checkpoint_names: string[];
  resupply_names: string[];
  hike_a_bike_hint: boolean;
  steep_unpaved: boolean;
  steep_unpaved_max_grade_pct: number | null;
  steep_unpaved_spans: RoadbookSteepSpan[];
  race_plan_notes: string;
  poi_highlights: RoadbookPoiHighlight[];
  one_liner_it: string;
};

function clipRange(lo: number, hi: number, segLo: number, segHi: number): number {
  const a = Math.max(lo, segLo);
  const b = Math.min(hi, segHi);
  return b > a ? b - a : 0;
}

/** Km per tipo superficie in [kmLo, kmHi). */
export function surfaceKmInRange(
  segments: ReadonlyArray<SurfaceKmSpan>,
  kmLo: number,
  kmHi: number
): RoadbookSurfaceKm {
  const lo = Math.min(kmLo, kmHi);
  const hi = Math.max(kmLo, kmHi);
  const o: RoadbookSurfaceKm = { asphalt: 0, gravel: 0, single: 0, unknown: 0 };
  for (const s of segments) {
    const len = clipRange(lo, hi, s.km_start, s.km_end);
    if (len > 0) o[s.surface] += len;
  }
  return o;
}

function surfacePctFromKm(km: RoadbookSurfaceKm): RoadbookSurfacePct {
  const t = km.asphalt + km.gravel + km.single + km.unknown;
  if (t < 1e-6) {
    return { asphalt: 0, gravel: 0, single: 0, unknown: 0 };
  }
  return {
    asphalt: (km.asphalt / t) * 100,
    gravel: (km.gravel / t) * 100,
    single: (km.single / t) * 100,
    unknown: (km.unknown / t) * 100,
  };
}

function isUnpavedForSteep(kind: TrackSurfaceKind | null): boolean {
  if (kind == null) return true;
  return kind !== "asphalt";
}

/** Segmento struttura GPX interseca [chunkLo, chunkHi)? */
function segmentIntersectsChunk(k0: number, k1: number, chunkLo: number, chunkHi: number): boolean {
  const a = Math.min(k0, k1);
  const b = Math.max(k0, k1);
  return b > chunkLo && a < chunkHi;
}

export function computeSteepUnpavedInChunk(
  coords: StoredCoord[],
  surfaceSpans: ReadonlyArray<SurfaceKmSpan>,
  chunkLo: number,
  chunkHi: number,
  gradeThresholdPct = STEEP_UNPAVED_GRADE_PCT,
  minHorizontalM = STEEP_MIN_HORIZONTAL_M
): {
  steep_unpaved: boolean;
  steep_unpaved_max_grade_pct: number | null;
  steep_unpaved_spans: RoadbookSteepSpan[];
} {
  const spans: RoadbookSteepSpan[] = [];
  let maxGrade = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const c0 = coords[i]!;
    const c1 = coords[i + 1]!;
    const k0 = c0[3];
    const k1 = c1[3];
    if (!segmentIntersectsChunk(k0, k1, chunkLo, chunkHi)) continue;

    const dhM = Math.abs(k1 - k0) * 1000;
    if (dhM < minHorizontalM) continue;

    const e0 = c0[2];
    const e1 = c1[2];
    if (e0 == null || e1 == null || !Number.isFinite(e0) || !Number.isFinite(e1)) continue;

    const midKm = (k0 + k1) / 2;
    const surf = surfaceKindAtKm(surfaceSpans, midKm);
    if (!isUnpavedForSteep(surf)) continue;

    const grade = (Math.abs(e1 - e0) / dhM) * 100;
    if (grade < gradeThresholdPct) continue;

    if (grade > maxGrade) maxGrade = grade;
    const spanLo = Math.min(k0, k1);
    const spanHi = Math.max(k0, k1);
    spans.push({
      km_start: spanLo,
      km_end: spanHi,
      grade_pct_max: Math.round(grade * 10) / 10,
    });
  }

  spans.sort((a, b) => a.km_start - b.km_start);
  const merged = mergeAdjacentSteepSpans(spans);
  const top = merged.slice(0, 2);

  return {
    steep_unpaved: maxGrade >= gradeThresholdPct,
    steep_unpaved_max_grade_pct: maxGrade > 0 ? Math.round(maxGrade * 10) / 10 : null,
    steep_unpaved_spans: top,
  };
}

function mergeAdjacentSteepSpans(spans: RoadbookSteepSpan[]): RoadbookSteepSpan[] {
  if (spans.length === 0) return [];
  const out: RoadbookSteepSpan[] = [];
  let cur = { ...spans[0]! };
  for (let i = 1; i < spans.length; i++) {
    const s = spans[i]!;
    if (s.km_start <= cur.km_end + 0.05) {
      cur.km_end = Math.max(cur.km_end, s.km_end);
      cur.grade_pct_max = Math.max(cur.grade_pct_max, s.grade_pct_max);
    } else {
      out.push(cur);
      cur = { ...s };
    }
  }
  out.push(cur);
  return out;
}

function sectionHikeHint(s: NotableSectionRow): boolean {
  const L = s.label.trim().toLowerCase();
  if (L.startsWith("hab:") || L.startsWith("hike")) return true;
  if (s.severity === "hard") return true;
  return false;
}

function sectionsIntersectChunk(sections: NotableSectionRow[], lo: number, hi: number): NotableSectionRow[] {
  return sections.filter((s) => s.km_end > lo && s.km_start < hi);
}

function hikeHintInChunk(sections: NotableSectionRow[], lo: number, hi: number): boolean {
  return sectionsIntersectChunk(sections, lo, hi).some(sectionHikeHint);
}

/** D+/D- approssimati solo sui punti con cumKm in [lo, hi]. */
export function elevGainLossInKmRange(coords: StoredCoord[], lo: number, hi: number): {
  gain: number;
  loss: number;
  elev_min: number | null;
  elev_max: number | null;
} {
  let gain = 0;
  let loss = 0;
  let emin: number | null = null;
  let emax: number | null = null;

  for (let i = 0; i < coords.length; i++) {
    const c = coords[i]!;
    const km = c[3];
    const e = c[2];
    if (km + 1e-9 < lo || km - 1e-9 > hi) continue;
    if (e != null && Number.isFinite(e)) {
      emin = emin == null ? e : Math.min(emin, e);
      emax = emax == null ? e : Math.max(emax, e);
    }
  }

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const k0 = a[3];
    const k1 = b[3];
    const kMid = (k0 + k1) / 2;
    if (kMid < lo || kMid >= hi) continue;
    const e0 = a[2];
    const e1 = b[2];
    if (e0 == null || e1 == null || !Number.isFinite(e0) || !Number.isFinite(e1)) continue;
    const d = e1 - e0;
    if (d > 0) gain += d;
    else loss += -d;
  }

  return { gain, loss, elev_min: emin, elev_max: emax };
}

const FOOD_CATS: PoiCategory[] = ["restaurant", "shop", "hut"];

function poisInChunk(
  pois: PoiRow[],
  lo: number,
  hi: number,
  maxDetourM: number
): PoiRow[] {
  return pois.filter(
    (p) => p.along_km >= lo - 1e-9 && p.along_km < hi && p.detour_m <= maxDetourM
  );
}

function racePlanNotesForChunk(items: RacePlanItemRow[], lo: number, hi: number, maxLen = 400): string {
  const parts: string[] = [];
  let len = 0;
  for (const it of items) {
    if (it.km_end <= lo || it.km_start >= hi) continue;
    const bit = [it.title, it.body].filter(Boolean).join(" — ").trim();
    if (!bit) continue;
    if (len + bit.length > maxLen) break;
    parts.push(bit);
    len += bit.length + 2;
  }
  return parts.join(" · ");
}

export type RoadbookChunkCore = Omit<RoadbookChunk, "one_liner_it">;

function buildOneLiner(c: RoadbookChunkCore): string {
  const parts: string[] = [];
  const sk = c.surface_km;
  const tot = sk.asphalt + sk.gravel + sk.single + sk.unknown;
  if (tot > 0.5) {
    const g = ((sk.gravel / tot) * 100).toFixed(0);
    const sg = ((sk.single / tot) * 100).toFixed(0);
    const asp = ((sk.asphalt / tot) * 100).toFixed(0);
    parts.push(`Sterrato ~${g}%, single ~${sg}%, asfalto ~${asp}%`);
  }
  if (c.elev_min_m != null) parts.push(`min ${Math.round(c.elev_min_m)} m`);
  if (c.count_water > 0) parts.push("acqua sì");
  else parts.push("acqua no");
  if (c.count_food > 0 || c.has_official_resupply) parts.push("ristoro sì");
  else parts.push("ristoro no");
  if (c.hike_a_bike_hint) parts.push("HAB");
  if (c.steep_unpaved) parts.push(`ripido sterrato ≥${STEEP_UNPAVED_GRADE_PCT}%`);
  return parts.join(" · ");
}

export type BuildRoadbookChunksInput = {
  lengthKm: number;
  coords: StoredCoord[];
  surfaceSegments: ReadonlyArray<SurfaceKmSpan>;
  pois: PoiRow[];
  checkpoints: CheckpointRow[];
  resupply: ResupplyRow[];
  notableSections: NotableSectionRow[];
  racePlanItems: RacePlanItemRow[];
  chunkKm?: number;
  maxDetourM?: number;
};

/**
 * Costruisce tutti i chunk [0, lengthKm] con ampiezza `chunkKm`.
 */
export function buildFullRoadbook(input: BuildRoadbookChunksInput): RoadbookChunk[] {
  const chunkKm = Math.max(1, input.chunkKm ?? 10);
  const maxDetourM = input.maxDetourM ?? 1500;
  const L = input.lengthKm;
  const chunks: RoadbookChunk[] = [];
  let idx = 0;
  for (let start = 0; start < L - 1e-9; start += chunkKm) {
    const end = Math.min(L, start + chunkKm);
    chunks.push(
      buildSingleChunk({
        ...input,
        chunk_index: idx,
        km_start: start,
        km_end: end,
        maxDetourM,
      })
    );
    idx += 1;
  }
  return chunks;
}

type SingleChunkInput = BuildRoadbookChunksInput & {
  chunk_index: number;
  km_start: number;
  km_end: number;
  maxDetourM: number;
};

function buildSingleChunk(input: SingleChunkInput): RoadbookChunk {
  const lo = input.km_start;
  const hi = input.km_end;
  const surface_km = surfaceKmInRange(input.surfaceSegments, lo, hi);
  const surface_pct = surfacePctFromKm(surface_km);
  const classified = surface_km.asphalt + surface_km.gravel + surface_km.single + surface_km.unknown;
  const surface_low_confidence =
    classified < 0.5 || (classified > 0 && surface_km.unknown / classified > 0.5);

  const elev = elevGainLossInKmRange(input.coords, lo, hi);
  const hasElev = elev.elev_min != null;

  const inChunkPois = poisInChunk(input.pois, lo, hi, input.maxDetourM);
  const count_water = inChunkPois.filter((p) => p.category === "water").length;
  const count_food = inChunkPois.filter((p) => FOOD_CATS.includes(p.category)).length;
  const count_lodging = inChunkPois.filter((p) => p.category === "lodging").length;
  const count_pharmacy = inChunkPois.filter((p) => p.category === "pharmacy").length;

  const cps = input.checkpoints.filter((c) => c.along_km >= lo - 1e-9 && c.along_km < hi);
  const rs = input.resupply.filter((r) => r.along_km >= lo - 1e-9 && r.along_km < hi);

  const steep = computeSteepUnpavedInChunk(input.coords, input.surfaceSegments, lo, hi);

  const poi_highlights = [...inChunkPois]
    .sort((a, b) => a.along_km - b.along_km)
    .slice(0, 3)
    .map((p) => ({
      category: p.category,
      name: p.name,
      along_km: p.along_km,
      detour_m: p.detour_m,
    }));

  const base: RoadbookChunkCore = {
    schema_version: ROADBOOK_SCHEMA_VERSION,
    chunk_index: input.chunk_index,
    km_start: lo,
    km_end: hi,
    surface_km,
    surface_pct,
    surface_low_confidence,
    elev_min_m: hasElev ? elev.elev_min : null,
    elev_max_m: hasElev ? elev.elev_max : null,
    elev_gain_m_approx: hasElev ? Math.round(elev.gain) : null,
    elev_loss_m_approx: hasElev ? Math.round(elev.loss) : null,
    count_water,
    count_food,
    count_lodging,
    count_pharmacy,
    has_checkpoint: cps.length > 0,
    has_official_resupply: rs.length > 0,
    checkpoint_names: cps.map((c) => c.name),
    resupply_names: rs.map((r) => r.name),
    hike_a_bike_hint: hikeHintInChunk(input.notableSections, lo, hi),
    steep_unpaved: steep.steep_unpaved,
    steep_unpaved_max_grade_pct: steep.steep_unpaved_max_grade_pct,
    steep_unpaved_spans: steep.steep_unpaved_spans,
    race_plan_notes: racePlanNotesForChunk(input.racePlanItems, lo, hi),
    poi_highlights,
  };

  return {
    ...base,
    one_liner_it: buildOneLiner(base),
  };
}

/**
 * Chunk a partire da quello che contiene `atKm`, per `count` blocchi.
 */
export function buildRoadbookAhead(
  input: BuildRoadbookChunksInput,
  atKm: number,
  aheadChunks: number,
  chunkKm?: number
): RoadbookChunk[] {
  const ck = Math.max(1, chunkKm ?? input.chunkKm ?? 10);
  const L = input.lengthKm;
  const km = Math.max(0, Math.min(L, atKm));
  const startIdx = Math.min(Math.floor(km / ck), Math.max(0, Math.ceil(L / ck) - 1));
  const maxDetourM = input.maxDetourM ?? 1500;
  const out: RoadbookChunk[] = [];
  for (let i = 0; i < aheadChunks; i++) {
    const idx = startIdx + i;
    const lo = idx * ck;
    if (lo >= L - 1e-9) break;
    const hi = Math.min(L, lo + ck);
    out.push(
      buildSingleChunk({
        ...input,
        chunk_index: idx,
        km_start: lo,
        km_end: hi,
        maxDetourM,
      })
    );
  }
  return out;
}

/** Indice chunk che contiene `atKm`. */
export function chunkIndexAtKm(atKm: number, lengthKm: number, chunkKm: number): number {
  const ck = Math.max(1, chunkKm);
  const km = Math.max(0, Math.min(lengthKm, atKm));
  return Math.min(Math.floor(km / ck), Math.max(0, Math.ceil(lengthKm / ck) - 1));
}
