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

/** Tipi visualizzabili/cercabili sopra le categorie DB (category + sub_kind). */
export type PoiKind =
  | "acqua"
  | "rifugio"
  | "bivacco"
  | "shelter"
  | "market"
  | "supermercato"
  | "ristorante"
  | "lodging"
  | "hotel"
  | "campsite"
  | "pharmacy"
  | "atm"
  | "bus";

export type PoiKindMeta = {
  id: PoiKind;
  label: string;
  color: string;
  category: PoiCategory;
  /** Se presente, solo questi sub_kind appartengono al kind. */
  subKinds?: string[];
};

export const POI_KIND_META: Record<PoiKind, PoiKindMeta> = {
  acqua: {
    id: "acqua",
    label: "Acqua",
    color: "#38bdf8",
    category: "water",
  },
  rifugio: {
    id: "rifugio",
    label: "Rifugio",
    color: "#ef4444",
    category: "hut",
    subKinds: ["alpine_hut"],
  },
  bivacco: {
    id: "bivacco",
    label: "Bivacco",
    color: "#f97316",
    category: "hut",
    subKinds: ["wilderness_hut"],
  },
  shelter: {
    id: "shelter",
    label: "Shelter",
    color: "#a3a3a3",
    category: "hut",
    subKinds: ["shelter"],
  },
  market: {
    id: "market",
    label: "Market",
    color: "#34d399",
    category: "shop",
  },
  supermercato: {
    id: "supermercato",
    label: "Supermercato",
    color: "#22c55e",
    category: "shop",
    subKinds: ["supermarket"],
  },
  ristorante: {
    id: "ristorante",
    label: "Ristorante",
    color: "#fb923c",
    category: "restaurant",
  },
  lodging: {
    id: "lodging",
    label: "Letto",
    color: "#a78bfa",
    category: "lodging",
  },
  hotel: {
    id: "hotel",
    label: "Hotel",
    color: "#8b5cf6",
    category: "lodging",
    subKinds: ["hotel"],
  },
  campsite: {
    id: "campsite",
    label: "Campsite",
    color: "#4ade80",
    category: "campsite",
  },
  pharmacy: {
    id: "pharmacy",
    label: "Salute",
    color: "#f472b6",
    category: "pharmacy",
  },
  atm: {
    id: "atm",
    label: "Servizi",
    color: "#fde047",
    category: "atm",
  },
  bus: {
    id: "bus",
    label: "Bus",
    color: "#94a3b8",
    category: "bus",
  },
};

/** Kind usati nella barra di ricerca unificata (viewport). */
export const SEARCH_KINDS: PoiKindMeta[] = [
  POI_KIND_META.shelter,
  POI_KIND_META.bivacco,
  POI_KIND_META.rifugio,
  POI_KIND_META.supermercato,
  POI_KIND_META.ristorante,
  POI_KIND_META.hotel,
  POI_KIND_META.acqua,
];

/** Chip multi-selezione per ricerca nell'area visibile della mappa. */
export const VIEWPORT_SEARCH_KINDS: PoiKindMeta[] = [
  POI_KIND_META.bivacco,
  POI_KIND_META.shelter,
  POI_KIND_META.supermercato,
  POI_KIND_META.ristorante,
  POI_KIND_META.hotel,
];

const SEARCH_KEYWORDS: Record<PoiKind, string[]> = {
  acqua: ["acqua", "fontana", "sorgente", "drinking", "water"],
  rifugio: ["rifugio", "refuge", "alpine hut", "alpine_hut"],
  bivacco: ["bivacco", "bivouac", "wilderness", "wilderness_hut"],
  shelter: ["shelter", "tettoia", "emergenza", "riparo"],
  market: ["market", "alimentari", "spesa", "negozio", "shop"],
  supermercato: ["supermercato", "supermarket", "iper", "market"],
  ristorante: ["ristorante", "restaurant", "cibo", "trattoria", "osteria"],
  lodging: ["ostello", "letto", "alloggio", "guest house"],
  hotel: ["hotel", "albergo"],
  campsite: ["campsite", "campeggio", "bivouac"],
  pharmacy: ["farmacia", "pharmacy", "salute", "ospedale"],
  atm: ["atm", "bancomat", "servizi", "benzina"],
  bus: ["bus", "autobus", "fermata"],
};

export function searchKindKeywords(kind: PoiKind): string[] {
  return SEARCH_KEYWORDS[kind];
}

/** Risolve il kind visualizzabile da category + sub_kind OSM. */
export function resolvePoiKind(category: PoiCategory, subKind: string): PoiKindMeta {
  if (category === "hut") {
    if (subKind === "alpine_hut") return POI_KIND_META.rifugio;
    if (subKind === "wilderness_hut") return POI_KIND_META.bivacco;
    if (subKind === "shelter") return POI_KIND_META.shelter;
    return POI_KIND_META.rifugio;
  }
  if (category === "water") return POI_KIND_META.acqua;
  if (category === "shop") {
    if (subKind === "supermarket") return POI_KIND_META.supermercato;
    return POI_KIND_META.market;
  }
  if (category === "restaurant") return POI_KIND_META.ristorante;
  if (category === "lodging") {
    if (subKind === "hotel") return POI_KIND_META.hotel;
    return POI_KIND_META.lodging;
  }
  if (category === "campsite") return POI_KIND_META.campsite;
  if (category === "pharmacy") return POI_KIND_META.pharmacy;
  if (category === "atm") return POI_KIND_META.atm;
  if (category === "bus") return POI_KIND_META.bus;
  return POI_KIND_META.market;
}

/** Filtra POI per kind (subKinds se definiti). */
export function poiMatchesKind(
  category: PoiCategory,
  subKind: string,
  kind: PoiKindMeta
): boolean {
  if (category !== kind.category) return false;
  if (!kind.subKinds || kind.subKinds.length === 0) return true;
  return kind.subKinds.includes(subKind);
}

export function poiMatchesAnyKind(
  category: PoiCategory,
  subKind: string,
  kinds: PoiKindMeta[]
): boolean {
  return kinds.some((k) => poiMatchesKind(category, subKind, k));
}

/** Suggerimenti categoria dalla query (case-insensitive, substring). */
export function matchSearchKinds(query: string): PoiKindMeta[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return SEARCH_KINDS.filter((k) => {
    if (k.label.toLowerCase().includes(q)) return true;
    return searchKindKeywords(k.id).some((kw) => kw.toLowerCase().includes(q) || q.includes(kw.toLowerCase()));
  });
}
