import type { UserRouteActivity } from "@/lib/db";

export type OutingDto = {
  id: string;
  route_id: string;
  owner: string;
  title: string;
  outing_date: string | null;
  notes: string;
  /** @deprecated use notes */
  snow_notes: string;
  activity: UserRouteActivity;
  created_at: number;
  updated_at: number;
  participants: string[];
  group_ids: string[];
};

export function formatOutingDate(iso: string | null): string {
  if (!iso) return "Data non indicata";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
