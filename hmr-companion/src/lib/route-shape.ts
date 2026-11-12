/**
 * Forma di un tracciato: anello, andata e ritorno, traversata (funzione pura).
 */
type Pt = [number, number];

export type RouteShape = "anello" | "andata_ritorno" | "traversata";

export const ROUTE_SHAPE_LABEL: Record<RouteShape, string> = {
  anello: "Anello",
  andata_ritorno: "Andata e ritorno",
  traversata: "Traversata",
};

function distM(a: Pt, b: Pt): number {
  const dx = (b[0] - a[0]) * 111_320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dy = (b[1] - a[1]) * 110_540;
  return Math.hypot(dx, dy);
}

/** Ricampiona a ~N punti equidistanti per indice (sufficiente per il confronto di forma). */
function thin(line: Pt[], max = 300): Pt[] {
  if (line.length <= max) return line;
  const step = (line.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, k) => line[Math.round(k * step)]!);
}

export type DerivedFacts = {
  shape: RouteShape | null;
  ele_min_dem: number | null;
  ele_max_dem: number | null;
  start: [number, number] | null;
  computed_at: number;
};

/** Fatti derivati da salvare in `meta_json.derived` (quote dal DEM se disponibili). */
export function buildDerivedFacts(coords: Pt[], elev: number[] | null, now = Date.now()): DerivedFacts {
  const valid = (elev ?? []).filter((e) => Number.isFinite(e) && e > -500 && e < 9000);
  const start = coords[0] ? ([Math.round(coords[0][0] * 1e6) / 1e6, Math.round(coords[0][1] * 1e6) / 1e6] as Pt) : null;
  return {
    shape: classifyRouteShape(coords),
    ele_min_dem: valid.length ? Math.round(Math.min(...valid)) : null,
    ele_max_dem: valid.length ? Math.round(Math.max(...valid)) : null,
    start,
    computed_at: now,
  };
}

/**
 * @param closeM distanza inizio–fine sotto cui il percorso «torna al punto di partenza»
 * @param overlapM distanza entro cui un punto del ritorno ricalca l'andata
 */
export function classifyRouteShape(coords: Pt[], closeM = 250, overlapM = 50): RouteShape | null {
  const line = thin(coords.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])));
  if (line.length < 3) return null;
  const start = line[0]!;
  const end = line[line.length - 1]!;
  if (distM(start, end) > closeM) return "traversata";
  const mid = Math.floor(line.length / 2);
  const first = line.slice(0, mid + 1);
  const second = line.slice(mid);
  let near = 0;
  for (const p of second) {
    let best = Infinity;
    for (const q of first) {
      const d = distM(p, q);
      if (d < best) best = d;
      if (best <= overlapM) break;
    }
    if (best <= overlapM) near++;
  }
  return near / second.length >= 0.7 ? "andata_ritorno" : "anello";
}
