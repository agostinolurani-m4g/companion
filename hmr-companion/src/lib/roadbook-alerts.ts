/**
 * Alert deterministici per gara / race-brief (codici stabili).
 */

import type { PoiCategory, PoiRow, ResupplyRow } from "@/lib/db";
import type { RoadbookChunk } from "@/lib/roadbook-chunk";

export type AlertLevel = "info" | "warn";

export type RoadbookAlert = {
  level: AlertLevel;
  code: string;
  message_it: string;
};

const FOOD_CATS: PoiCategory[] = ["restaurant", "shop", "hut"];

function hasFoodOrResupplyInWindow(
  pois: PoiRow[],
  resupply: ResupplyRow[],
  atKm: number,
  windowKm: number,
  maxDetourM: number
): boolean {
  const lo = atKm;
  const hi = atKm + windowKm;
  if (
    resupply.some((r) => r.along_km > lo && r.along_km <= hi)
  ) {
    return true;
  }
  return pois.some(
    (p) =>
      FOOD_CATS.includes(p.category) &&
      p.along_km > lo &&
      p.along_km <= hi &&
      p.detour_m <= maxDetourM
  );
}

function hasWaterInWindow(
  pois: PoiRow[],
  atKm: number,
  windowKm: number,
  maxDetourM: number
): boolean {
  const lo = atKm;
  const hi = atKm + windowKm;
  return pois.some(
    (p) =>
      p.category === "water" &&
      p.along_km > lo &&
      p.along_km <= hi &&
      p.detour_m <= maxDetourM
  );
}

export type BuildAlertsInput = {
  atKm: number;
  lengthKm: number;
  pois: PoiRow[];
  resupply: ResupplyRow[];
  maxDetourM: number;
  /** Primi chunk da `atKm` (stesso ordine di buildRoadbookAhead). */
  chunksAhead: RoadbookChunk[];
};

export function buildRoadbookAlerts(input: BuildAlertsInput): RoadbookAlert[] {
  const alerts: RoadbookAlert[] = [];
  const { atKm, lengthKm, pois, resupply, maxDetourM, chunksAhead } = input;

  if (!hasFoodOrResupplyInWindow(pois, resupply, atKm, 20, maxDetourM)) {
    alerts.push({
      level: "warn",
      code: "NO_FOOD_20",
      message_it:
        "Nei prossimi 20 km non risultano ristoranti/negozi/rifugi o resupply ufficiale entro la distanza impostata dalla traccia.",
    });
  }

  if (!hasWaterInWindow(pois, atKm, 15, maxDetourM)) {
    alerts.push({
      level: "warn",
      code: "NO_WATER_15",
      message_it:
        "Nei prossimi 15 km non risultano punti acqua entro la distanza impostata dalla traccia.",
    });
  }

  const cur = chunksAhead[0];
  const next = chunksAhead[1];
  if (cur?.hike_a_bike_hint || next?.hike_a_bike_hint) {
    alerts.push({
      level: "info",
      code: "HAB_SOON",
      message_it:
        "Hike-a-bike o tratto segnalato come molto impegnativo nel tratto attuale o nel prossimo blocco.",
    });
  }

  if (cur?.steep_unpaved || next?.steep_unpaved) {
    const g = Math.max(
      cur?.steep_unpaved_max_grade_pct ?? 0,
      next?.steep_unpaved_max_grade_pct ?? 0
    );
    alerts.push({
      level: "info",
      code: "STEEP_UNPAVED_SOON",
      message_it: `Possibili tratti ripidi su sterrato/sentiero (stima ≥15% da profilo GPX${
        g > 0 ? `, fino ~${g}%` : ""
      }) — valuta se proseguire a piedi.`,
    });
  }

  if (cur?.surface_low_confidence) {
    alerts.push({
      level: "info",
      code: "SURFACE_UNKNOWN",
      message_it:
        "Superficie strada poco mappata da OSM nel blocco corrente: le percentuali asfalto/sterrato sono indicative.",
    });
  }

  void lengthKm;
  return alerts;
}
