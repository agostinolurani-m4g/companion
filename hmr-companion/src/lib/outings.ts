import {
  getUserRoute,
  listOutingGroups,
  listOutingParticipants,
  type OutingRow,
} from "@/lib/db";
import type { OutingDto } from "@/lib/outings-types";

export type { OutingDto } from "@/lib/outings-types";
export { formatOutingDate } from "@/lib/outings-types";

export function serializeOuting(row: OutingRow): OutingDto {
  const route = getUserRoute(row.route_id);
  return {
    id: row.id,
    route_id: row.route_id,
    owner: row.owner,
    title: row.title,
    outing_date: row.outing_date,
    notes: row.notes,
    snow_notes: row.notes,
    activity: route?.activity ?? "hike",
    created_at: row.created_at,
    updated_at: row.updated_at,
    participants: listOutingParticipants(row.id),
    group_ids: listOutingGroups(row.id),
  };
}

export function serializeOutings(rows: OutingRow[]): OutingDto[] {
  return rows.map(serializeOuting);
}

/** @deprecated use serializeOuting */
export function serializeSkiOuting(row: OutingRow) {
  return serializeOuting(row);
}

/** @deprecated use serializeOutings */
export function serializeSkiOutings(rows: OutingRow[]) {
  return serializeOutings(rows);
}
