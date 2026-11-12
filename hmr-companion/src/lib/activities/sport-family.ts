/**
 * Sport "compatibili" per leggere la heatmap: chi pianifica un trekking vuole
 * vedere anche dove corrono i trail runner, chi fa MTB anche gravel/e-bike.
 */
const SPORT_FAMILIES: Record<string, string[]> = {
  foot: ["hike", "trail_run", "walk", "run", "alpinism", "ferrata"],
  offroad_bike: ["mtb", "gravel", "ebike", "bikepacking"],
  road_bike: ["road", "gravel", "ebike", "bikepacking"],
  winter: ["ski", "snowshoe", "nordic", "alpinism"],
};

export function heatSportFamily(sport: string): string[] {
  switch (sport) {
    case "hike":
    case "trail_run":
    case "walk":
    case "run":
    case "alpinism":
    case "ferrata":
      return SPORT_FAMILIES.foot;
    case "mtb":
    case "ebike":
    case "bikepacking":
      return SPORT_FAMILIES.offroad_bike;
    case "road":
    case "gravel":
      return SPORT_FAMILIES.road_bike;
    case "ski":
    case "snowshoe":
    case "nordic":
      return SPORT_FAMILIES.winter;
    default:
      return [sport];
  }
}
