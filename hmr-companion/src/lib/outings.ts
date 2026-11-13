import {
  getUserRoute,
  listOutingGroups,
  listOutingParticipants,
  listOutingStops,
  listUserPhotosForOuting,
  type OutingRow,
} from "@/lib/db";
import {
  isOutingStopKind,
  parseOutingConditions,
  type OutingDto,
} from "@/lib/outings-types";
import { avatarUrl } from "@/lib/social-labels";

export type { OutingDto } from "@/lib/outings-types";
export { formatOutingDate } from "@/lib/outings-types";

export function serializeOuting(row: OutingRow): OutingDto {
  const route = getUserRoute(row.route_id);
  return {
    id: row.id,
    route_id: row.route_id,
    route_name: route?.name ?? null,
    owner: row.owner,
    title: row.title,
    outing_date: row.outing_date,
    start_time: row.start_time ?? null,
    status: row.status ?? "done",
    visibility: row.visibility ?? "participants",
    notes: row.notes,
    story: row.story ?? "",
    conditions: parseOutingConditions(row.conditions_json),
    activity: route?.activity ?? "hike",
    created_at: row.created_at,
    updated_at: row.updated_at,
    participants: listOutingParticipants(row.id),
    group_ids: listOutingGroups(row.id),
    stops: listOutingStops(row.id).map((s) => ({
      role: s.role,
      kind: isOutingStopKind(s.kind) ? s.kind : "other",
      name: s.name,
      lng: s.lng,
      lat: s.lat,
      along_km: s.along_km,
      ref: s.ref,
      note: s.note,
      overnight: s.overnight === 1,
    })),
    photos: listUserPhotosForOuting(row.id).map((p) => ({
      id: p.id,
      url: avatarUrl(p.photo_path) ?? "",
      caption: p.caption,
      lng: p.lng,
      lat: p.lat,
      owner: p.owner,
    })),
  };
}

export function serializeOutings(rows: OutingRow[]): OutingDto[] {
  return rows.map(serializeOuting);
}
