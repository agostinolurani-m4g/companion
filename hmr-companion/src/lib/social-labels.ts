import type { GroupType, ProfileLevel } from "@/lib/db";

export const LEVEL_LABELS: Record<ProfileLevel, string> = {
  beginner: "Principiante",
  intermediate: "Intermedio",
  advanced: "Avanzato",
  expert: "Esperto",
};

export const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  friends: "Amici",
  club: "Club / CAI",
  trip: "Gita",
  custom: "Altro",
};

export function avatarUrl(avatarPath: string | null | undefined): string | null {
  if (!avatarPath) return null;
  return `/api/field-photo?path=${encodeURIComponent(avatarPath)}`;
}
