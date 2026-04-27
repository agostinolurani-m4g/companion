import type { Feature, FeatureCollection, LineString } from "geojson";
import type { OutingFeedRow } from "@/lib/db";

/** Converte righe feed in GeoJSON per MapLibre (linee percorso canonico + metadati uscita). */
export function outingFeedToFeatureCollection(rows: OutingFeedRow[]): FeatureCollection {
  const features: Feature[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.route_line_geojson) as Feature<LineString> | LineString;
      const geometry =
        parsed.type === "Feature" && parsed.geometry?.type === "LineString"
          ? parsed.geometry
          : (parsed as LineString).type === "LineString"
            ? (parsed as LineString)
            : null;
      if (!geometry) continue;
      features.push({
        type: "Feature",
        properties: {
          outing_id: row.id,
          route_id: row.route_id,
          route_name: row.route_name,
          author_user_id: row.author_user_id,
          author_name: row.author_display_name,
          started_at: row.started_at,
          visibility: row.visibility,
          notes: row.notes ?? "",
          snow_conditions_text: row.snow_conditions_text ?? "",
          weather_snapshot_json: row.weather_snapshot_json ?? "",
        },
        geometry,
      });
    } catch {
      /* skip */
    }
  }
  return { type: "FeatureCollection", features };
}
