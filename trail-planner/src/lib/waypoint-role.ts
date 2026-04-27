import type { SegmentType, StopRow, WaypointRole } from "@/lib/types";

/** Ruoli strutturali lungo l’itinerario (indipendenti dalla categoria segment_type). */
export const WAYPOINT_ROLE_LABELS: Record<WaypointRole, string> = {
  trip_start: "Partenza itinerario",
  trip_end: "Arrivo itinerario",
  leg_start: "Inizio tappa",
  leg_end: "Fine tappa",
  via: "Intermedio",
  poi: "Passaggio / nota",
};

export function waypointRoleOptionsForStop(
  index: number,
  total: number
): WaypointRole[] {
  const all: WaypointRole[] = [
    "trip_start",
    "trip_end",
    "leg_start",
    "leg_end",
    "via",
    "poi",
  ];
  if (total <= 1) return ["trip_start"];
  if (index === 0) return all.filter((r) => r !== "trip_end");
  if (index === total - 1) return all.filter((r) => r !== "trip_start");
  return all.filter((r) => r !== "trip_start" && r !== "trip_end");
}

/** Passaggio sul percorso (icona piccola, conteggio “passaggi”). */
export function isPassThroughWaypoint(stop: Pick<StopRow, "waypoint_role">): boolean {
  return stop.waypoint_role === "poi";
}

/** Inferenza default ruolo medio da categoria legacy. */
export function defaultWaypointRoleForSegmentType(st: SegmentType): WaypointRole {
  if (st === "poi") return "poi";
  return "via";
}
