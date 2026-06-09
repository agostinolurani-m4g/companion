import type { TrackJournalEntryRow } from "@/lib/db";

export function computeJournalCompleteness(
  lengthKm: number,
  summary: string | null | undefined,
  entries: TrackJournalEntryRow[]
): number {
  let score = 0;
  const max = 100;

  if (summary && summary.trim().length >= 20) score += 30;
  else if (summary && summary.trim().length > 0) score += 15;

  const photos = entries.filter((e) => e.kind === "photo").length;
  const notes = entries.filter((e) => e.kind === "note" || e.kind === "condition").length;
  const milestones = entries.filter((e) => e.kind === "milestone").length;

  score += Math.min(30, photos * 10);
  score += Math.min(20, notes * 5);
  score += Math.min(10, milestones * 5);

  if (lengthKm > 0 && photos > 0) {
    const expectedPhotos = Math.max(1, Math.floor(lengthKm / 5));
    score += Math.min(10, Math.round((photos / expectedPhotos) * 10));
  }

  return Math.min(max, Math.round(score));
}
