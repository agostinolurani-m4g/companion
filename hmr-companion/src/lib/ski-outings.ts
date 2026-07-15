import {
  listOutingGroups,
  listOutingParticipants,
  type SkiOutingRow,
} from "@/lib/db";
import type { SkiOutingDto } from "@/lib/ski-outings-types";

export type { SkiOutingDto } from "@/lib/ski-outings-types";
export { formatOutingDate } from "@/lib/ski-outings-types";

export function serializeSkiOuting(row: SkiOutingRow): SkiOutingDto {
  return {
    id: row.id,
    route_id: row.route_id,
    owner: row.owner,
    title: row.title,
    outing_date: row.outing_date,
    snow_notes: row.snow_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    participants: listOutingParticipants(row.id),
    group_ids: listOutingGroups(row.id),
  };
}

export function serializeSkiOutings(rows: SkiOutingRow[]): SkiOutingDto[] {
  return rows.map(serializeSkiOuting);
}
