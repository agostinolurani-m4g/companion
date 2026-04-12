import type { ActivityType } from "@/lib/types";

/** Etichette italiane per la modalità mappa / routing OSRM. */
export const MAP_ACTIVITY_OPTIONS: {
  value: ActivityType;
  label: string;
  routingHint: string;
}[] = [
  {
    value: "hiking",
    label: "Escursionismo / trekking",
    routingHint: "foot-hiking (OpenRoute Service se hai API key) altrimenti OSRM foot",
  },
  { value: "running", label: "Corsa su strada", routingHint: "OSRM walking" },
  {
    value: "trail_running",
    label: "Trail running",
    routingHint: "foot-hiking (con API key) o OSRM foot",
  },
  { value: "road_bike", label: "Bici da corsa", routingHint: "OSRM cycling" },
  { value: "mtb", label: "MTB", routingHint: "OSRM cycling" },
  { value: "gravel", label: "Gravel", routingHint: "OSRM cycling" },
  {
    value: "ski_mountaineering",
    label: "Sci alpinismo",
    routingHint: "foot-hiking (con API key) o OSRM foot",
  },
  {
    value: "nordic_ski",
    label: "Sci di fondo",
    routingHint: "foot-hiking (con API key) o OSRM foot",
  },
];

export function activityLabel(value: string): string {
  const o = MAP_ACTIVITY_OPTIONS.find((x) => x.value === value);
  return o?.label ?? value;
}
