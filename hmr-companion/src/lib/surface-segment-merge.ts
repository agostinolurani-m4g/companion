import type { TrackSurfaceKind } from "@/lib/surface-osm";

const EPS = 1e-5;

export type SurfaceSegWithSource = {
  km_start: number;
  km_end: number;
  surface: TrackSurfaceKind;
  source: string;
};

/** Parti di `s` che restano fuori da [L, H] (ordinati L≤H). */
export function fragmentsOutsideRange(
  s: SurfaceSegWithSource,
  L: number,
  H: number
): SurfaceSegWithSource[] {
  const S = s.km_start;
  const E = s.km_end;
  if (E < L - EPS || S > H + EPS) return [{ ...s }];
  const out: SurfaceSegWithSource[] = [];
  if (S < L - EPS) {
    const end = Math.min(E, L);
    if (end > S + EPS) out.push({ ...s, km_start: S, km_end: end });
  }
  if (E > H + EPS) {
    const start = Math.max(S, H);
    if (E > start + EPS) out.push({ ...s, km_start: start, km_end: E });
  }
  return out;
}

function mergeSource(a: string, b: string): string {
  if (a === "user_manual" || b === "user_manual") return "user_manual";
  return a || b || "osm_overpass";
}

/** Ordina, unisce segmenti adiacenti con stessa superficie. */
export function mergeAdjacentSurfaceParts(parts: SurfaceSegWithSource[]): SurfaceSegWithSource[] {
  const sorted = [...parts].sort((a, b) => a.km_start - b.km_start);
  const out: SurfaceSegWithSource[] = [];
  for (const p of sorted) {
    if (p.km_end <= p.km_start + EPS) continue;
    const last = out[out.length - 1];
    if (last && last.surface === p.surface && p.km_start <= last.km_end + EPS) {
      last.km_end = Math.max(last.km_end, p.km_end);
      last.source = mergeSource(last.source, p.source);
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

/**
 * Sovrascrive [lo, hi] con `surface`, tagliando i segmenti esistenti che si sovrappongono.
 * `lo`/`hi` possono essere in qualsiasi ordine.
 */
export function applySurfaceKmOverride(
  existing: SurfaceSegWithSource[],
  lo: number,
  hi: number,
  surface: TrackSurfaceKind
): SurfaceSegWithSource[] {
  const L = Math.min(lo, hi);
  const H = Math.max(lo, hi);
  const parts: SurfaceSegWithSource[] = [];
  for (const s of existing) {
    parts.push(...fragmentsOutsideRange(s, L, H));
  }
  parts.push({
    km_start: L,
    km_end: H,
    surface,
    source: "user_manual",
  });
  return mergeAdjacentSurfaceParts(parts);
}
