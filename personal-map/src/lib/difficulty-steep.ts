import type { StoredCoord } from "@/lib/track-coords";
import { surfaceKindAtKm, type SurfaceKmSpan, type TrackSurfaceKind } from "@/lib/surface-osm";

export const STEEP_UNPAVED_GRADE_PCT = 15;
export const STEEP_MIN_HORIZONTAL_M = 40;

export type SteepSpan = {
  km_start: number;
  km_end: number;
  grade_pct_max: number;
};

function isUnpavedForSteep(kind: TrackSurfaceKind | null): boolean {
  if (kind == null) return true;
  return kind !== "asphalt";
}

function mergeAdjacentSteepSpans(spans: SteepSpan[]): SteepSpan[] {
  if (spans.length === 0) return [];
  const out: SteepSpan[] = [];
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

export function computeSteepUnpavedSpans(
  coords: StoredCoord[],
  surfaceSpans: ReadonlyArray<SurfaceKmSpan>,
  gradeThresholdPct = STEEP_UNPAVED_GRADE_PCT,
  minHorizontalM = STEEP_MIN_HORIZONTAL_M
): SteepSpan[] {
  const spans: SteepSpan[] = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const c0 = coords[i]!;
    const c1 = coords[i + 1]!;
    const k0 = c0[3];
    const k1 = c1[3];
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

    spans.push({
      km_start: Math.min(k0, k1),
      km_end: Math.max(k0, k1),
      grade_pct_max: Math.round(grade * 10) / 10,
    });
  }

  spans.sort((a, b) => a.km_start - b.km_start);
  return mergeAdjacentSteepSpans(spans);
}
