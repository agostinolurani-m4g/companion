export type SkiOutingDto = {
  id: string;
  route_id: string;
  owner: string;
  title: string;
  outing_date: string | null;
  snow_notes: string;
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
