import type { PoiCategory } from "./db";

export type CategoryMeta = {
  key: PoiCategory;
  label: string;
  short: string;
  color: string;
};

export const CATEGORY_META: Record<PoiCategory, CategoryMeta> = {
  water: { key: "water", label: "Acqua", short: "acqua", color: "#38bdf8" },
  hut: { key: "hut", label: "Rifugio", short: "rifugio", color: "#f87171" },
  lodging: { key: "lodging", label: "Letto", short: "letto", color: "#a78bfa" },
  campsite: { key: "campsite", label: "Campsite", short: "camp", color: "#4ade80" },
  shop: { key: "shop", label: "Spesa", short: "spesa", color: "#34d399" },
  restaurant: { key: "restaurant", label: "Cibo", short: "cibo", color: "#fb923c" },
  pharmacy: { key: "pharmacy", label: "Salute", short: "salute", color: "#f472b6" },
  atm: { key: "atm", label: "Servizi", short: "servizi", color: "#fde047" },
  bus: { key: "bus", label: "Bus", short: "bus", color: "#94a3b8" },
};

export const CATEGORY_ORDER: PoiCategory[] = [
  "water",
  "restaurant",
  "shop",
  "lodging",
  "campsite",
  "hut",
  "pharmacy",
  "atm",
  "bus",
];
