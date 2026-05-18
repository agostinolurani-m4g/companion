import type { PoiCategory } from "@/lib/db";
import { CATEGORY_ORDER } from "@/lib/categories";

export type RacePoiFilterPreset = "water" | "food" | "sleep" | "campsite" | "services" | "all";

export function categoriesForRacePreset(preset: RacePoiFilterPreset): Set<PoiCategory> {
  switch (preset) {
    case "water":
      return new Set<PoiCategory>(["water"]);
    case "food":
      return new Set<PoiCategory>(["restaurant", "shop"]);
    case "sleep":
      return new Set<PoiCategory>(["lodging", "hut"]);
    case "campsite":
      return new Set<PoiCategory>(["campsite"]);
    case "services":
      return new Set<PoiCategory>(["pharmacy", "atm", "bus"]);
    case "all":
    default:
      return new Set<PoiCategory>(CATEGORY_ORDER);
  }
}
