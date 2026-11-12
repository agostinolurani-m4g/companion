import type { UserRouteActivity } from "@/lib/sports";

/**
 * Mapping dei tipi di attività dei provider esterni sugli sport dell'app.
 * `null` = attività senza traccia outdoor significativa (indoor, virtuale,
 * piscina…): non viene importata.
 */
const STRAVA_SPORT_MAP: Record<string, UserRouteActivity | null> = {
  Ride: "road",
  GravelRide: "gravel",
  MountainBikeRide: "mtb",
  EBikeRide: "ebike",
  EMountainBikeRide: "ebike",
  VirtualRide: null,
  Velomobile: "road",
  Handcycle: "road",
  Run: "run",
  TrailRun: "trail_run",
  VirtualRun: null,
  Walk: "walk",
  Hike: "hike",
  BackcountrySki: "ski",
  NordicSki: "nordic",
  Snowshoe: "snowshoe",
  AlpineSki: null,
  Snowboard: null,
  RockClimbing: "alpinism",
  Swim: null,
  Workout: null,
  WeightTraining: null,
  Yoga: null,
};

export function mapStravaSport(sportType: string | null | undefined, legacyType?: string | null): UserRouteActivity | null {
  const key = sportType || legacyType || "";
  if (key in STRAVA_SPORT_MAP) return STRAVA_SPORT_MAP[key];
  if (legacyType && legacyType in STRAVA_SPORT_MAP) return STRAVA_SPORT_MAP[legacyType];
  return null;
}

/** FIT `session.sport` / `sub_sport` (già decodificati come stringhe). */
export function mapFitSport(sport: unknown, subSport: unknown): UserRouteActivity | null {
  const s = typeof sport === "string" ? sport : "";
  const sub = typeof subSport === "string" ? subSport : "";
  switch (s) {
    case "cycling":
      if (sub === "mountain" || sub === "downhill" || sub === "e_bike_mountain") return "mtb";
      if (sub === "gravel_cycling" || sub === "cyclocross" || sub === "mixed_surface") return "gravel";
      if (sub === "indoor_cycling" || sub === "spin" || sub === "virtual_activity") return null;
      return "road";
    case "e_biking":
      return "ebike";
    case "running":
      if (sub === "trail") return "trail_run";
      if (sub === "treadmill" || sub === "indoor_running" || sub === "virtual_activity") return null;
      return "run";
    case "walking":
      return "walk";
    case "hiking":
      return "hike";
    case "mountaineering":
      return "alpinism";
    case "cross_country_skiing":
      return "nordic";
    case "alpine_skiing":
      return sub === "backcountry" ? "ski" : null;
    case "snowshoeing":
      return "snowshoe";
    default:
      return null;
  }
}

/**
 * Tipo testuale da GPX `<type>`, TCX `Sport="…"`, colonna "Activity Type"
 * dell'export Strava o nomi Komoot (es. "hike", "mtb", "touringbicycle").
 */
export function mapFreeTextSport(raw: string | null | undefined): UserRouteActivity | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!t) return null;
  if (t in STRAVA_SPORT_MAP_LOWER) return STRAVA_SPORT_MAP_LOWER[t];
  if (/(mountain_?bike|mtb|mountainbike|enduro)/.test(t)) return "mtb";
  if (/gravel/.test(t)) return "gravel";
  if (/(e_?bike|e_?mtb|pedelec)/.test(t)) return "ebike";
  if (/(bikepack)/.test(t)) return "bikepacking";
  if (/(road|racebike|ride|biking|bicycle|cycling|bike)/.test(t)) return "road";
  if (/(trail_?run|trailrunning)/.test(t)) return "trail_run";
  if (/(run|jog)/.test(t)) return "run";
  if (/(hik|trek|mountaineering_?hike)/.test(t)) return "hike";
  if (/(walk)/.test(t)) return "walk";
  if (/(ski_?tour|backcountry|skitour|scialp)/.test(t)) return "ski";
  if (/(nordic|cross_?country|langlauf|fondo)/.test(t)) return "nordic";
  if (/(snowshoe|ciaspol)/.test(t)) return "snowshoe";
  if (/(ferrata|klettersteig)/.test(t)) return "ferrata";
  if (/(alpin|climb|mountaineer)/.test(t)) return "alpinism";
  return null;
}

const STRAVA_SPORT_MAP_LOWER: Record<string, UserRouteActivity | null> = Object.fromEntries(
  Object.entries(STRAVA_SPORT_MAP).map(([k, v]) => [k.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase(), v]),
);
