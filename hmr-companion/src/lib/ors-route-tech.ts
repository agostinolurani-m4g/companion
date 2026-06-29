/**
 * Parsing extra_info OpenRouteService (surface, waytype, steepness, traildifficulty).
 */

import { lineLengthKm } from "@/lib/osrm-route";
import type { TrackSurfaceKind, SurfaceKmSpan } from "@/lib/surface-osm";
import { formatTerrainIt, mergeSurfaceSpans } from "@/lib/surface-osm";

export const SURFACE_COLORS: Record<TrackSurfaceKind, string> = {
  asphalt: "#94a3b8",
  gravel: "#eab308",
  single: "#22c55e",
  unknown: "#64748b",
};

/** Segmenti ORS grezzi: [fromIdx, toIdx, valueCode]. */
export type OrsExtraValues = [number, number, number][];

export type OrsExtrasRaw = {
  surface?: { values?: OrsExtraValues };
  waytype?: { values?: OrsExtraValues };
  steepness?: { values?: OrsExtraValues };
  traildifficulty?: { values?: OrsExtraValues };
};

export type RouteTechSegment = {
  fromKm: number;
  toKm: number;
  surface: TrackSurfaceKind;
  waytype: string;
  steepness: string;
  difficulty: string;
};

export type RouteTechSummary = {
  surface_pct: { asphalt: number; gravel: number; single: number; unknown: number };
  max_difficulty: string | null;
  max_steepness: string | null;
};

export type RouteColoredSegment = {
  coordinates: [number, number][];
  color: string;
  surface: TrackSurfaceKind;
};

export type RouteTech = {
  segments: RouteTechSegment[];
  summary: RouteTechSummary;
  surface_bands: SurfaceKmSpan[];
  colored_segments: RouteColoredSegment[];
};

const ORS_SURFACE: Record<number, TrackSurfaceKind> = {
  0: "unknown",
  1: "asphalt",
  2: "gravel",
  3: "asphalt",
  4: "asphalt",
  5: "gravel",
  6: "unknown",
  7: "single",
  8: "gravel",
  9: "gravel",
  10: "gravel",
  11: "gravel",
  12: "gravel",
  13: "unknown",
  14: "asphalt",
  15: "gravel",
  16: "gravel",
  17: "gravel",
  18: "gravel",
};

const ORS_WAYTYPE: Record<number, string> = {
  0: "unknown",
  1: "state_road",
  2: "road",
  3: "street",
  4: "path",
  5: "track",
  6: "cycleway",
  7: "footway",
  8: "steps",
  9: "ferry",
  10: "construction",
};

const ORS_STEEPNESS: Record<number, string> = {
  0: "unknown",
  1: "flat",
  2: "uphill",
  3: "downhill",
  4: "steep_uphill",
  5: "steep_downhill",
};

const ORS_TRAIL_DIFFICULTY: Record<number, string> = {
  0: "unknown",
  1: "T1",
  2: "T2",
  3: "T3",
  4: "T4",
  5: "T5",
  6: "T6",
};

const STEEPNESS_RANK: Record<string, number> = {
  unknown: 0,
  flat: 1,
  uphill: 2,
  downhill: 2,
  steep_uphill: 4,
  steep_downhill: 4,
};

const DIFFICULTY_RANK: Record<string, number> = {
  unknown: 0,
  T1: 1,
  T2: 2,
  T3: 3,
  T4: 4,
  T5: 5,
  T6: 6,
};

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Cumulativo km per ogni vertice della linea. */
export function cumulativeKmAtIndices(coords: [number, number][]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    out.push(out[i - 1]! + haversineKm(coords[i - 1]!, coords[i]!));
  }
  return out;
}

function lookupExtra(values: OrsExtraValues | undefined, idx: number): number {
  if (!values?.length) return 0;
  for (const [from, to, code] of values) {
    if (idx >= from && idx <= to) return code;
  }
  return 0;
}

function surfaceFromOrs(surfaceCode: number, waytypeCode: number): TrackSurfaceKind {
  const wt = ORS_WAYTYPE[waytypeCode] ?? "unknown";
  if (["path", "footway", "steps"].includes(wt)) return "single";
  if (wt === "track") return "gravel";
  const base = ORS_SURFACE[surfaceCode] ?? "unknown";
  if (base !== "unknown") return base;
  if (["state_road", "road", "street", "cycleway"].includes(wt)) return "asphalt";
  return "unknown";
}

function formatSteepnessIt(code: string): string {
  switch (code) {
    case "flat":
      return "Piano";
    case "uphill":
      return "Salita";
    case "downhill":
      return "Discesa";
    case "steep_uphill":
      return "Salita ripida";
    case "steep_downhill":
      return "Discesa ripida";
    default:
      return "—";
  }
}

function formatDifficultyIt(code: string): string {
  if (code === "unknown") return "—";
  return code;
}

function maxByRank<T extends string>(items: T[], rank: Record<string, number>): T | null {
  let best: T | null = null;
  let bestR = -1;
  for (const item of items) {
    const r = rank[item] ?? 0;
    if (r > bestR) {
      bestR = r;
      best = item;
    }
  }
  return bestR > 0 ? best : null;
}

function buildColoredSegments(
  coords: [number, number][],
  segments: RouteTechSegment[]
): RouteColoredSegment[] {
  const cum = cumulativeKmAtIndices(coords);
  const out: RouteColoredSegment[] = [];
  for (const seg of segments) {
    const slice: [number, number][] = [];
    for (let i = 0; i < cum.length; i++) {
      const k = cum[i]!;
      if (k + 1e-6 >= seg.fromKm && k - 1e-6 <= seg.toKm) {
        slice.push(coords[i]!);
      }
    }
    if (slice.length < 2) continue;
    out.push({
      coordinates: slice,
      color: SURFACE_COLORS[seg.surface],
      surface: seg.surface,
    });
  }
  if (out.length === 0 && coords.length >= 2) {
    out.push({
      coordinates: coords,
      color: SURFACE_COLORS.unknown,
      surface: "unknown",
    });
  }
  return out;
}

function surfacePctFromSegments(segments: RouteTechSegment[]): RouteTechSummary["surface_pct"] {
  const km: RouteTechSummary["surface_pct"] = { asphalt: 0, gravel: 0, single: 0, unknown: 0 };
  for (const s of segments) {
    const len = Math.max(0, s.toKm - s.fromKm);
    km[s.surface] += len;
  }
  const total = km.asphalt + km.gravel + km.single + km.unknown;
  if (total <= 0) return { asphalt: 0, gravel: 0, single: 0, unknown: 100 };
  return {
    asphalt: (km.asphalt / total) * 100,
    gravel: (km.gravel / total) * 100,
    single: (km.single / total) * 100,
    unknown: (km.unknown / total) * 100,
  };
}

/** Parsa extras ORS su una singola geometria route. */
export function parseOrsExtras(
  coords: [number, number][],
  extras: OrsExtrasRaw | undefined,
  kmOffset = 0
): RouteTech {
  if (!extras || coords.length < 2) {
    const len = lineLengthKm(coords);
    return {
      segments: [],
      summary: {
        surface_pct: { asphalt: 0, gravel: 0, single: 0, unknown: 100 },
        max_difficulty: null,
        max_steepness: null,
      },
      surface_bands: [],
      colored_segments:
        coords.length >= 2
          ? [{ coordinates: coords, color: SURFACE_COLORS.unknown, surface: "unknown" }]
          : [],
    };
  }

  const surfaceVals = extras.surface?.values ?? [];
  const waytypeVals = extras.waytype?.values ?? [];
  const steepVals = extras.steepness?.values ?? [];
  const diffVals = extras.traildifficulty?.values ?? [];

  const ranges = new Map<string, { from: number; to: number }>();
  for (const [from, to] of surfaceVals.map((v) => [v[0], v[1]] as const)) {
    ranges.set(`${from}:${to}`, { from, to });
  }
  for (const [from, to] of waytypeVals.map((v) => [v[0], v[1]] as const)) {
    ranges.set(`${from}:${to}`, { from, to });
  }
  for (const [from, to] of steepVals.map((v) => [v[0], v[1]] as const)) {
    ranges.set(`${from}:${to}`, { from, to });
  }
  for (const [from, to] of diffVals.map((v) => [v[0], v[1]] as const)) {
    ranges.set(`${from}:${to}`, { from, to });
  }

  const cum = cumulativeKmAtIndices(coords);
  const lengthKm = cum[cum.length - 1] ?? 0;

  const sortedRanges = [...ranges.values()].sort((a, b) => a.from - b.from || a.to - b.to);
  const segments: RouteTechSegment[] = [];
  const steepnessCodes: string[] = [];
  const difficultyCodes: string[] = [];

  for (const { from, to } of sortedRanges) {
    const mid = Math.min(coords.length - 1, Math.max(0, Math.floor((from + to) / 2)));
    const sc = lookupExtra(surfaceVals, mid);
    const wc = lookupExtra(waytypeVals, mid);
    const stc = lookupExtra(steepVals, mid);
    const dc = lookupExtra(diffVals, mid);
    const steepness = ORS_STEEPNESS[stc] ?? "unknown";
    const difficulty = ORS_TRAIL_DIFFICULTY[dc] ?? "unknown";
    steepnessCodes.push(steepness);
    difficultyCodes.push(difficulty);
    segments.push({
      fromKm: (cum[from] ?? 0) + kmOffset,
      toKm: (cum[Math.min(to, cum.length - 1)] ?? lengthKm) + kmOffset,
      surface: surfaceFromOrs(sc, wc),
      waytype: ORS_WAYTYPE[wc] ?? "unknown",
      steepness,
      difficulty,
    });
  }

  const mergedSegments =
    segments.length > 0
      ? segments
      : [
          {
            fromKm: kmOffset,
            toKm: kmOffset + lengthKm,
            surface: "unknown" as TrackSurfaceKind,
            waytype: "unknown",
            steepness: "unknown",
            difficulty: "unknown",
          },
        ];

  const kmSamples: number[] = [];
  const kindSamples: TrackSurfaceKind[] = [];
  for (const seg of mergedSegments) {
    kmSamples.push(seg.fromKm);
    kindSamples.push(seg.surface);
  }

  const surface_bands: SurfaceKmSpan[] = mergeSurfaceSpans(
    kmSamples,
    kindSamples,
    kmOffset + lengthKm
  ).map((s) => ({ km_start: s.km_start, km_end: s.km_end, surface: s.surface }));

  const maxSteep = maxByRank(steepnessCodes, STEEPNESS_RANK);
  const maxDiff = maxByRank(difficultyCodes, DIFFICULTY_RANK);

  return {
    segments: mergedSegments,
    summary: {
      surface_pct: surfacePctFromSegments(mergedSegments),
      max_difficulty: maxDiff ? formatDifficultyIt(maxDiff) : null,
      max_steepness: maxSteep ? formatSteepnessIt(maxSteep) : null,
    },
    surface_bands,
    colored_segments: buildColoredSegments(coords, mergedSegments),
  };
}

/** Unisce tech da più gambe (routing concatenato). */
export function mergeRouteTechParts(parts: RouteTech[]): RouteTech | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;

  const segments = parts.flatMap((p) => p.segments);
  const surface_bands = parts.flatMap((p) => p.surface_bands);
  const colored_segments = parts.flatMap((p) => p.colored_segments);

  const kmTotals = { asphalt: 0, gravel: 0, single: 0, unknown: 0 };
  for (const p of parts) {
    const pct = p.summary.surface_pct;
    const len =
      p.segments.reduce((s, seg) => s + Math.max(0, seg.toKm - seg.fromKm), 0) || 1;
    kmTotals.asphalt += (pct.asphalt / 100) * len;
    kmTotals.gravel += (pct.gravel / 100) * len;
    kmTotals.single += (pct.single / 100) * len;
    kmTotals.unknown += (pct.unknown / 100) * len;
  }
  const totalKm = kmTotals.asphalt + kmTotals.gravel + kmTotals.single + kmTotals.unknown;

  const steepnessCodes = segments.map((s) => s.steepness);
  const difficultyCodes = segments.map((s) => s.difficulty);
  const maxSteep = maxByRank(steepnessCodes, STEEPNESS_RANK);
  const maxDiff = maxByRank(difficultyCodes, DIFFICULTY_RANK);

  return {
    segments,
    surface_bands,
    colored_segments,
    summary: {
      surface_pct:
        totalKm > 0
          ? {
              asphalt: (kmTotals.asphalt / totalKm) * 100,
              gravel: (kmTotals.gravel / totalKm) * 100,
              single: (kmTotals.single / totalKm) * 100,
              unknown: (kmTotals.unknown / totalKm) * 100,
            }
          : { asphalt: 0, gravel: 0, single: 0, unknown: 100 },
      max_difficulty: maxDiff ? formatDifficultyIt(maxDiff) : null,
      max_steepness: maxSteep ? formatSteepnessIt(maxSteep) : null,
    },
  };
}

export function formatSurfacePctSummary(pct: RouteTechSummary["surface_pct"]): string {
  const parts: string[] = [];
  if (pct.asphalt >= 1) parts.push(`Asfalto ${pct.asphalt.toFixed(0)}%`);
  if (pct.gravel >= 1) parts.push(`Sterrato ${pct.gravel.toFixed(0)}%`);
  if (pct.single >= 1) parts.push(`Single ${pct.single.toFixed(0)}%`);
  if (pct.unknown >= 1 && parts.length === 0) parts.push(`Non class. ${pct.unknown.toFixed(0)}%`);
  return parts.length > 0 ? parts.join(" · ") : "Superficie non disponibile";
}

export { formatTerrainIt };
