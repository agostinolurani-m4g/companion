import type { PoiCategory } from "./db";

export type CategoryMeta = {
  key: PoiCategory;
  label: string;
  short: string;
  color: string;
  emoji: string;
};

export const CATEGORY_META: Record<PoiCategory, CategoryMeta> = {
  water: { key: "water", label: "Acqua", short: "acqua", color: "#38bdf8", emoji: "💧" },
  hut: { key: "hut", label: "Rifugio", short: "rifugio", color: "#f87171", emoji: "🏔️" },
  lodging: { key: "lodging", label: "Letto", short: "letto", color: "#a78bfa", emoji: "🛏️" },
  shop: { key: "shop", label: "Spesa", short: "spesa", color: "#34d399", emoji: "🛒" },
  restaurant: { key: "restaurant", label: "Cibo", short: "cibo", color: "#fb923c", emoji: "🍽️" },
  pharmacy: { key: "pharmacy", label: "Salute", short: "salute", color: "#f472b6", emoji: "➕" },
  atm: { key: "atm", label: "Servizi", short: "servizi", color: "#fde047", emoji: "💶" },
  bus: { key: "bus", label: "Bus", short: "bus", color: "#94a3b8", emoji: "🚌" },
};

export const CATEGORY_ORDER: PoiCategory[] = [
  "water",
  "restaurant",
  "shop",
  "lodging",
  "hut",
  "pharmacy",
  "atm",
  "bus",
];
