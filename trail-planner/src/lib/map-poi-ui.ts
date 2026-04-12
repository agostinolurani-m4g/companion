import type { MapPoiCategory } from "@/lib/types";

const LABELS: Record<MapPoiCategory, string> = {
  refuge: "Rifugio / bivacco",
  forest: "Bosco / foresta",
  peak: "Vetta / montagna",
  road: "Strada panoramica",
  water: "Acqua / lago / torrente",
  town: "Paese / località",
  viewpoint: "Belvedere / panorama",
  other: "Altro",
};

export function mapPoiCategoryLabel(cat: string): string {
  return LABELS[cat as MapPoiCategory] ?? cat;
}

/** Colore cerchio sulla mappa per categoria */
export const MAP_POI_CATEGORY_COLOR: Record<string, string> = {
  refuge: "#92400e",
  forest: "#15803d",
  peak: "#64748b",
  road: "#ea580c",
  water: "#0284c7",
  town: "#7c3aed",
  viewpoint: "#ca8a04",
  other: "#52525b",
};
