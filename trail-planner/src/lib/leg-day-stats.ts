import type { Position } from "geojson";
import type { StopRow } from "@/lib/types";
import { groupStopsByLeg, sortStopsByOrder } from "@/lib/leg-stops";
import { kmAlongLineForStop } from "@/lib/track-geometry";

export type LegDayStat = {
  legIndex: number;
  stopCount: number;
  /** Distanza lungo la traccia tra min e max proiezione delle tappe del giorno; null senza traccia. */
  distanceKm: number | null;
};

export function computeLegDayStats(stops: StopRow[], coords: Position[] | null): LegDayStat[] {
  const sorted = sortStopsByOrder(stops);
  const m = groupStopsByLeg(sorted);
  const legs = [...m.keys()].sort((a, b) => a - b);
  const out: LegDayStat[] = [];
  for (const leg of legs) {
    const group = m.get(leg)!;
    let distanceKm: number | null = null;
    if (coords && coords.length >= 2) {
      const kms = group
        .map((s) => kmAlongLineForStop(s.lng, s.lat, coords))
        .filter((k): k is number => k != null);
      if (kms.length >= 2) {
        distanceKm = Math.max(...kms) - Math.min(...kms);
      } else if (kms.length === 1) {
        distanceKm = 0;
      }
    }
    out.push({ legIndex: leg, stopCount: group.length, distanceKm });
  }
  return out;
}
