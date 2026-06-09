export type SportMode = "trekking" | "mtb" | "ski_mountaineering";

export const SPORT_MODES: { value: SportMode; label: string }[] = [
  { value: "trekking", label: "Escursionismo / trekking" },
  { value: "mtb", label: "Mountain bike" },
  { value: "ski_mountaineering", label: "Sci alpinismo" },
];

export function inferSportMode(activityType: string | null | undefined): SportMode {
  const a = (activityType ?? "").toLowerCase();
  if (a.includes("ski") || a.includes("scialp")) return "ski_mountaineering";
  if (a.includes("mtb") || a.includes("gravel") || a.includes("bike")) return "mtb";
  return "trekking";
}

export function sportModeLabel(mode: SportMode): string {
  return SPORT_MODES.find((s) => s.value === mode)?.label ?? mode;
}
