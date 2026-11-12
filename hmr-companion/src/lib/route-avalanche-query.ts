/**
 * URL per il confronto esposizioni percorso ↔ bollettino valanghe (GET /api/v2/ski/avalanche
 * con lat/lng/orientations/min_ele/max_ele). null se mancano punto di partenza o esposizioni.
 */
import type { RouteFacts } from "@/lib/route-facts";

export function routeAvalancheCheckUrl(start: [number, number] | null | undefined, facts: RouteFacts | null | undefined): string | null {
  if (!start || !facts || facts.orientations.length === 0) return null;
  const [lng, lat] = start;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const q = new URLSearchParams({
    lat: lat.toFixed(5),
    lng: lng.toFixed(5),
    // Le esposizioni sono in forma italiana (O, SO, NO): l'API le normalizza.
    orientations: facts.orientations.join(","),
  });
  if (facts.elevation.min != null) q.set("min_ele", String(Math.round(facts.elevation.min)));
  if (facts.elevation.max != null) q.set("max_ele", String(Math.round(facts.elevation.max)));
  return `/api/v2/ski/avalanche?${q}`;
}

export type RouteAvalancheNote = { status: string; text: string };
