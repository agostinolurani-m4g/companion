import { getUserProfile } from "@/lib/db";
import { avatarUrl } from "@/lib/social-labels";
import type { SegmentRow } from "./store";

export type SegmentDto = {
  id: string;
  owner: string;
  name: string;
  sport: string;
  length_m: number;
  elev_gain_m: number;
  avg_grade_pct: number;
  max_grade_pct: number;
  min_ele: number | null;
  max_ele: number | null;
  bbox: [number, number, number, number];
  visibility: SegmentRow["visibility"];
  created_at: number;
  geojson?: GeoJSON.LineString;
};

export function serializeSegment(row: SegmentRow, opts: { geometry?: boolean } = {}): SegmentDto {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    sport: row.sport,
    length_m: row.length_m,
    elev_gain_m: row.elev_gain_m,
    avg_grade_pct: row.avg_grade_pct,
    max_grade_pct: row.max_grade_pct,
    min_ele: row.min_ele,
    max_ele: row.max_ele,
    bbox: [row.bbox_w, row.bbox_s, row.bbox_e, row.bbox_n],
    visibility: row.visibility,
    created_at: row.created_at,
    ...(opts.geometry ? { geojson: JSON.parse(row.geojson) as GeoJSON.LineString } : {}),
  };
}

/** Nome visualizzato + avatar per le righe di classifica (senza creare profili). */
export function personLabel(username: string): { username: string; display_name: string; avatar_url: string | null } {
  const p = getUserProfile(username);
  return {
    username,
    display_name: p?.display_name || username,
    avatar_url: avatarUrl(p?.avatar_path ?? null),
  };
}
