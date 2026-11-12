/** Gruppi logici per filtri mappa e conteggi area. */
export const OUTDOOR_GROUPS = [
  "shelter",
  "signage",
  "water",
  "terrain",
  "safety",
  "transport",
  "climb",
  "trail",
  "hazard",
  "service",
  "obstacle",
  "culture",
  "nature",
] as const;

export type OutdoorGroup = (typeof OUTDOOR_GROUPS)[number];

export const OUTDOOR_GROUP_LABELS: Record<OutdoorGroup, string> = {
  shelter: "Ripari",
  signage: "Segnaletica",
  water: "Acqua",
  terrain: "Terreno",
  safety: "Sicurezza",
  transport: "Trasporti",
  climb: "Arrampicata",
  trail: "Sentieri e piste",
  hazard: "Chiusure e rischi",
  service: "Servizi",
  obstacle: "Ostacoli",
  culture: "Cultura",
  nature: "Natura",
};
