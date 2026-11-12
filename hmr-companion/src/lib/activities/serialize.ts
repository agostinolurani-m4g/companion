import { parseActivityLine, type ActivityRow } from "./store";

export type ActivityDto = {
  id: string;
  provider: ActivityRow["provider"];
  sport: string;
  name: string;
  start_time: number;
  distance_m: number;
  elev_gain_m: number;
  moving_time_s: number | null;
  bbox: [number, number, number, number];
  community_consent: boolean;
  in_community_heatmap: boolean;
  review_state: ActivityRow["review_state"];
  /** Punto più alto (o ultimo se manca la quota): ancora per segnalazioni/condizioni. */
  high_point: [number, number, number | null];
  end_point: [number, number];
  can_publish: boolean;
  geojson?: GeoJSON.LineString;
};

export function highPoint(line: GeoJSON.LineString): [number, number, number | null] {
  let best: GeoJSON.Position | null = null;
  for (const c of line.coordinates) {
    if (c.length > 2 && (best == null || (best[2] ?? -Infinity) < c[2])) best = c;
  }
  if (best) return [best[0], best[1], best[2] ?? null];
  const mid = line.coordinates[Math.floor(line.coordinates.length / 2)];
  return [mid[0], mid[1], null];
}

export function serializeActivity(row: ActivityRow, opts: { geometry?: boolean } = {}): ActivityDto {
  const line = parseActivityLine(row);
  const last = line.coordinates[line.coordinates.length - 1];
  return {
    id: row.id,
    provider: row.provider,
    sport: row.sport,
    name: row.name,
    start_time: row.start_time,
    distance_m: row.distance_m,
    elev_gain_m: row.elev_gain_m,
    moving_time_s: row.moving_time_s,
    bbox: [row.bbox_w, row.bbox_s, row.bbox_e, row.bbox_n],
    community_consent: row.community_consent === 1,
    in_community_heatmap: row.heat_scopes.split(",").includes("community"),
    review_state: row.review_state,
    high_point: highPoint(line),
    end_point: [last[0], last[1]],
    // Le tracce Strava non si ripubblicano come percorso: contano solo nella heatmap.
    can_publish: row.provider !== "strava",
    ...(opts.geometry ? { geojson: line } : {}),
  };
}
