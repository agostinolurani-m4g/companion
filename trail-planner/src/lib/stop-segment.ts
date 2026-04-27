import type { StopRow } from "@/lib/types";

/**
 * Punto di passaggio (POI lungo il percorso), da non confondere con una **tappa**
 * (sosta principale: destinazione, rifugio, pasto, trasporto, ecc.).
 */
export function isPassThroughPoint(stop: Pick<StopRow, "segment_type" | "waypoint_role">): boolean {
  return stop.waypoint_role === "poi";
}
