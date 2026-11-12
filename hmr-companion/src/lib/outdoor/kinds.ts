import type { UserRouteActivity } from "@/lib/sports";
import type { OutdoorGroup } from "./groups";

export type OutdoorGeom = "point" | "line" | "area";

export type OutdoorKindMeta = {
  kind: string;
  label: string;
  group: OutdoorGroup;
  geom: OutdoorGeom;
  minZoom: number;
  color: string;
  /** Sport per cui è rilevante; vuoto = tutti. */
  sports: UserRouteActivity[];
  searchWeight: number;
};

const ALL_SPORTS: UserRouteActivity[] = [
  "hike",
  "trail_run",
  "mtb",
  "road",
  "gravel",
  "ski",
  "snowshoe",
  "nordic",
  "ferrata",
];

function meta(
  kind: string,
  label: string,
  group: OutdoorGroup,
  geom: OutdoorGeom,
  minZoom: number,
  color: string,
  sports: UserRouteActivity[] = ALL_SPORTS,
  searchWeight = 1,
): OutdoorKindMeta {
  return { kind, label, group, geom, minZoom, color, sports, searchWeight };
}

/** Registro metadati (~100 tipi). */
export const OUTDOOR_KIND_META: Record<string, OutdoorKindMeta> = {};

function reg(m: OutdoorKindMeta): void {
  OUTDOOR_KIND_META[m.kind] = m;
}

// shelter
reg(meta("alpine_hut", "Rifugio", "shelter", "point", 11, "#ef4444", ["hike", "trail_run", "ski", "snowshoe", "ferrata"], 10));
reg(meta("wilderness_hut", "Bivacco", "shelter", "point", 12, "#f97316", ["hike", "trail_run", "ski", "snowshoe", "ferrata"], 10));
reg(meta("shelter", "Riparo", "shelter", "point", 12, "#a3a3a3", ALL_SPORTS, 6));
reg(meta("shelter_basic", "Riparo semplice", "shelter", "point", 13, "#94a3b8", ALL_SPORTS, 4));
reg(meta("lean_to", "Tettoia", "shelter", "point", 13, "#78716c", ["hike", "trail_run"], 4));
reg(meta("alpine_farm", "Malga", "shelter", "point", 12, "#eab308", ["hike", "trail_run", "mtb"], 5));
reg(meta("chalet", "Baita", "shelter", "point", 12, "#ca8a04", ALL_SPORTS, 5));

// signage
reg(meta("guidepost", "Cartello / palina", "signage", "point", 14, "#0ea5e9", ALL_SPORTS, 7));
reg(meta("information_board", "Tabellone", "signage", "point", 14, "#0284c7", ALL_SPORTS, 6));
reg(meta("map_board", "Mappa", "signage", "point", 14, "#0369a1", ALL_SPORTS, 5));
reg(meta("trail_marker", "Segnavia", "signage", "point", 15, "#38bdf8", ["hike", "trail_run", "mtb"], 4));
reg(meta("destination_sign", "Cartello destinazioni", "signage", "point", 14, "#0ea5e9", ALL_SPORTS, 8));
reg(meta("tourism_office", "Ufficio turistico", "signage", "point", 12, "#64748b", ALL_SPORTS, 3));

// water
reg(meta("drinking_water", "Acqua potabile", "water", "point", 13, "#38bdf8", ALL_SPORTS, 8));
reg(meta("spring", "Sorgente", "water", "point", 13, "#22d3ee", ["hike", "trail_run", "mtb", "ski", "snowshoe"], 8));
reg(meta("fountain", "Fontana", "water", "point", 14, "#60a5fa", ALL_SPORTS, 5));
reg(meta("water_point", "Punto acqua", "water", "point", 13, "#3b82f6", ALL_SPORTS, 6));
reg(meta("water_tap", "Rubinetto", "water", "point", 14, "#93c5fd", ALL_SPORTS, 4));
reg(meta("waterfall", "Cascata", "water", "point", 11, "#67e8f9", ["hike", "trail_run"], 4));
reg(meta("water_trough", "Abbeveratoio", "water", "point", 14, "#7dd3fc", ["hike", "mtb"], 3));

// terrain
reg(meta("peak", "Vetta", "terrain", "point", 11, "#1e293b", ALL_SPORTS, 10));
reg(meta("saddle", "Sella / passo", "terrain", "point", 12, "#475569", ALL_SPORTS, 9));
reg(meta("mountain_pass", "Valico", "terrain", "point", 12, "#64748b", ALL_SPORTS, 8));
reg(meta("viewpoint", "Panorama", "terrain", "point", 12, "#f59e0b", ALL_SPORTS, 7));
reg(meta("cave_entrance", "Grotta", "terrain", "point", 12, "#57534e", ["hike", "ferrata"], 5));
reg(meta("glacier", "Ghiacciaio", "terrain", "area", 10, "#bae6fd", ["ski", "snowshoe", "hike", "ferrata"], 6));
reg(meta("rock", "Roccia", "terrain", "point", 13, "#78716c", ["hike", "ferrata", "mtb"], 3));
reg(meta("stone", "Masso", "terrain", "point", 14, "#a8a29e", ["hike"], 2));
reg(meta("volcano", "Vulcano", "terrain", "point", 10, "#dc2626", ["hike"], 5));

// safety
reg(meta("defibrillator", "Defibrillatore", "safety", "point", 13, "#ef4444", ALL_SPORTS, 6));
reg(meta("emergency_phone", "Telefono emergenza", "safety", "point", 13, "#f87171", ALL_SPORTS, 7));
reg(meta("mountain_rescue", "Soccorso alpino", "safety", "point", 12, "#dc2626", ALL_SPORTS, 8));
reg(meta("helicopter_pad", "Elisoccorso", "safety", "point", 12, "#b91c1c", ["ski", "hike", "ferrata"], 6));
reg(meta("hospital", "Ospedale", "safety", "point", 10, "#f472b6", ALL_SPORTS, 5));
reg(meta("first_aid", "Primo soccorso", "safety", "point", 13, "#fb7185", ALL_SPORTS, 5));

// transport
reg(meta("aerialway_station", "Stazione funivia", "transport", "point", 11, "#8b5cf6", ["ski", "hike"], 7));
reg(meta("aerialway_line", "Funivia / skilift", "transport", "line", 11, "#a78bfa", ["ski", "hike"], 5));
reg(meta("trailhead", "Inizio sentiero", "transport", "point", 13, "#22c55e", ["hike", "trail_run", "mtb"], 7));
reg(meta("parking", "Parcheggio", "transport", "point", 12, "#94a3b8", ALL_SPORTS, 4));
reg(meta("bus_stop", "Fermata bus", "transport", "point", 12, "#64748b", ALL_SPORTS, 4));
reg(meta("train_station", "Stazione", "transport", "point", 11, "#475569", ALL_SPORTS, 5));
reg(meta("cable_car", "Funivia", "transport", "line", 11, "#c4b5fd", ["ski", "hike"], 5));

// climb
reg(meta("via_ferrata", "Via ferrata", "climb", "line", 12, "#e879f9", ["ferrata", "hike"], 9));
reg(meta("climbing_crag", "Falesia", "climb", "point", 12, "#d946ef", ["ferrata", "hike"], 6));
reg(meta("climbing_route", "Via arrampicata", "climb", "point", 13, "#c026d3", ["ferrata"], 5));

// trail lines
reg(meta("path_hiking", "Sentiero", "trail", "line", 13, "#fbbf24", ["hike", "trail_run"], 5));
reg(meta("path_mtb", "Sentiero MTB", "trail", "line", 13, "#34d399", ["mtb"], 5));
reg(meta("footway", "Cammino", "trail", "line", 14, "#fcd34d", ["hike", "trail_run"], 4));
reg(meta("track", "Mulattiera", "trail", "line", 13, "#d97706", ["hike", "mtb", "trail_run"], 4));
reg(meta("bridleway", "Ippovia", "trail", "line", 14, "#a3e635", ["hike"], 3));
reg(meta("steps", "Scalinata", "trail", "line", 14, "#f97316", ["hike", "ferrata"], 5));
reg(meta("piste_downhill", "Pista da sci", "trail", "line", 12, "#38bdf8", ["ski"], 6));
reg(meta("piste_nordic", "Pista di fondo", "trail", "line", 12, "#7dd3fc", ["nordic"], 6));
reg(meta("piste_skitour", "Scialpinismo", "trail", "line", 12, "#0ea5e9", ["ski", "snowshoe"], 6));
reg(meta("piste_hike", "Sentiero invernale", "trail", "line", 12, "#bae6fd", ["snowshoe", "hike"], 5));
reg(meta("route_hiking", "Itinerario escursionistico", "trail", "line", 11, "#f59e0b", ["hike", "trail_run"], 6));
reg(meta("route_mtb", "Itinerario MTB", "trail", "line", 11, "#10b981", ["mtb"], 5));
reg(meta("cycleway", "Ciclabile", "trail", "line", 12, "#60a5fa", ["road", "gravel", "mtb"], 4));

// hazard
reg(meta("trail_abandoned", "Sentiero abbandonato", "hazard", "line", 13, "#ef4444", ALL_SPORTS, 8));
reg(meta("trail_disused", "Sentiero dismesso", "hazard", "line", 13, "#f97316", ALL_SPORTS, 8));
reg(meta("access_no", "Accesso vietato", "hazard", "line", 13, "#dc2626", ALL_SPORTS, 7));
reg(meta("construction", "In costruzione", "hazard", "line", 13, "#eab308", ALL_SPORTS, 5));
reg(meta("seasonal_closed", "Chiusura stagionale", "hazard", "line", 13, "#fb923c", ALL_SPORTS, 6));
reg(meta("winter_road", "Strada invernale", "hazard", "line", 12, "#93c5fd", ["ski", "snowshoe", "nordic"], 4));

// service
reg(meta("camp_site", "Campeggio", "service", "point", 12, "#4ade80", ["hike", "mtb"], 5));
reg(meta("picnic_site", "Area picnic", "service", "point", 13, "#86efac", ALL_SPORTS, 4));
reg(meta("fireplace", "Punto fuoco", "service", "point", 14, "#f97316", ["hike", "trail_run"], 5));
reg(meta("toilets", "Servizi igienici", "service", "point", 13, "#cbd5e1", ALL_SPORTS, 3));
reg(meta("bench", "Panchina", "service", "point", 16, "#94a3b8", ["hike", "trail_run"], 2));
reg(meta("restaurant", "Ristorante", "service", "point", 12, "#fb923c", ALL_SPORTS, 5));
reg(meta("cafe", "Bar / caffè", "service", "point", 12, "#fdba74", ALL_SPORTS, 4));
reg(meta("shop_supermarket", "Supermercato", "service", "point", 11, "#22c55e", ALL_SPORTS, 4));
reg(meta("shop_outdoor", "Negozio outdoor", "service", "point", 12, "#14b8a6", ALL_SPORTS, 4));
reg(meta("bicycle_repair", "Officina bici", "service", "point", 12, "#2dd4bf", ["road", "gravel", "mtb"], 5));
reg(meta("charging_station", "Ricarica e-bike", "service", "point", 13, "#06b6d4", ["road", "gravel", "mtb"], 4));
reg(meta("hotel", "Hotel", "service", "point", 11, "#a78bfa", ALL_SPORTS, 4));
reg(meta("pharmacy", "Farmacia", "service", "point", 11, "#f472b6", ALL_SPORTS, 4));
reg(meta("fuel", "Benzina", "service", "point", 11, "#fde047", ["road", "gravel", "mtb"], 3));
reg(meta("atm", "Bancomat", "service", "point", 12, "#facc15", ALL_SPORTS, 2));

// obstacle
reg(meta("gate", "Cancello", "obstacle", "point", 14, "#78716c", ALL_SPORTS, 5));
reg(meta("stile", "Scaletta", "obstacle", "point", 14, "#57534e", ["hike", "trail_run"], 4));
reg(meta("cattle_grid", "Griglia", "obstacle", "point", 14, "#44403c", ["hike", "mtb"], 4));
reg(meta("ford", "Guado", "obstacle", "point", 13, "#0ea5e9", ["hike", "mtb", "trail_run"], 6));

// culture
reg(meta("chapel", "Cappella", "culture", "point", 13, "#e2e8f0", ["hike", "trail_run"], 3));
reg(meta("wayside_shrine", "Edicola", "culture", "point", 14, "#f1f5f9", ["hike"], 2));
reg(meta("cross", "Croce", "culture", "point", 13, "#cbd5e1", ["hike", "trail_run"], 4));
reg(meta("memorial", "Memoriale", "culture", "point", 13, "#94a3b8", ["hike"], 3));
reg(meta("ruins", "Rovine", "culture", "point", 12, "#a8a29e", ["hike"], 4));
reg(meta("fort", "Forte / trincea", "culture", "point", 12, "#78716c", ["hike"], 4));
reg(meta("bunker", "Bunker", "culture", "point", 13, "#57534e", ["hike"], 3));

// nature
reg(meta("protected_area", "Area protetta", "nature", "area", 9, "#86efac", ALL_SPORTS, 3));
reg(meta("national_park", "Parco nazionale", "nature", "area", 8, "#4ade80", ALL_SPORTS, 4));
reg(meta("tree_monument", "Albero monumentale", "nature", "point", 14, "#16a34a", ["hike"], 3));
reg(meta("hunting_stand", "Altana caccia", "nature", "point", 14, "#65a30d", ["hike", "mtb"], 2));

// external synthetic kinds
reg(meta("refuges_info", "Rifugio (refuges.info)", "shelter", "point", 11, "#ef4444", ["hike", "ski", "snowshoe"], 9));
reg(meta("weather_station", "Stazione meteo", "safety", "point", 11, "#38bdf8", ALL_SPORTS, 5));
reg(meta("trail_closure_ch", "Chiusura sentiero (CH)", "hazard", "line", 12, "#dc2626", ALL_SPORTS, 8));
reg(meta("wildlife_quiet", "Zona fauna (CH)", "nature", "area", 11, "#fbbf24", ["hike", "trail_run", "mtb"], 6));

export function kindMeta(kind: string): OutdoorKindMeta | undefined {
  return OUTDOOR_KIND_META[kind];
}

export function kindLabel(kind: string): string {
  return OUTDOOR_KIND_META[kind]?.label ?? kind;
}

export function kindVisibleAtZoom(kind: string, zoom: number): boolean {
  const m = OUTDOOR_KIND_META[kind];
  if (!m) return zoom >= 14;
  return zoom >= m.minZoom;
}

export function kindRelevantForSport(kind: string, sport: UserRouteActivity): boolean {
  const m = OUTDOOR_KIND_META[kind];
  if (!m || m.sports.length === 0) return true;
  return m.sports.includes(sport);
}
