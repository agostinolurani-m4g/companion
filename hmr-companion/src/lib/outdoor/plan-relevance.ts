import { projectOnRoute, type LngLat } from "@/lib/route-insert";

/** Ostacoli (cancelli, scalette, griglie): contano solo se sono sul tracciato. */
export const ON_ROUTE_ONLY_KINDS = new Set(["gate", "stile", "cattle_grid"]);
export const ON_ROUTE_MAX_M = 25;

/** Parcheggi e stazioni servono solo per arrivare alla partenza. */
export const START_ONLY_KINDS = new Set(["parking", "train_station", "bus_stop"]);
export const START_MAX_M = 1500;

function metersBetween(a: LngLat, b: LngLat): number {
  const cos = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dx = (b.lng - a.lng) * cos * 111_320;
  const dy = (b.lat - a.lat) * 111_320;
  return Math.hypot(dx, dy);
}

export type PlanContext = {
  /** Linea del percorso calcolato, se c'è. */
  route: [number, number][] | null;
  /** Punto di partenza (prima tappa), se c'è. */
  start: LngLat | null;
};

/**
 * Un punto outdoor va mostrato nel pianificatore?
 * - cancelli & co.: solo entro {@link ON_ROUTE_MAX_M} dal tracciato (senza percorso: mai);
 * - parcheggi/stazioni: solo entro {@link START_MAX_M} dalla partenza (senza partenza: sì,
 *   aiutano a sceglierla).
 */
export function isRelevantForPlan(kind: string, p: LngLat, ctx: PlanContext): boolean {
  if (ON_ROUTE_ONLY_KINDS.has(kind)) {
    if (!ctx.route || ctx.route.length < 2) return false;
    const proj = projectOnRoute(ctx.route, p);
    return !!proj && proj.distM <= ON_ROUTE_MAX_M;
  }
  if (START_ONLY_KINDS.has(kind)) {
    if (!ctx.start) return true;
    return metersBetween(ctx.start, p) <= START_MAX_M;
  }
  return true;
}

/**
 * Filtra i punti per il pianificatore e marca con `hl` quelli dei gruppi evidenziati
 * (gli altri restano discreti sulla mappa).
 */
export function planFeatureCollection(
  fc: GeoJSON.FeatureCollection | null,
  ctx: PlanContext,
  highlight: readonly string[] | null,
): GeoJSON.FeatureCollection | null {
  if (!fc) return null;
  const hl = new Set(highlight ?? []);
  const features: GeoJSON.Feature[] = [];
  for (const f of fc.features) {
    const props = (f.properties ?? {}) as { kind?: string; grp?: string };
    if (f.geometry.type === "Point") {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      if (!isRelevantForPlan(props.kind ?? "", { lng, lat }, ctx)) continue;
    }
    features.push({ ...f, properties: { ...f.properties, hl: hl.has(props.grp ?? "") } });
  }
  return { type: "FeatureCollection", features };
}
