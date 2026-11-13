import type { UserRouteActivity } from "@/lib/sports";

/**
 * Gita = un'uscita su una traccia.
 * - `planned`: piano (data, partenza/arrivo, soste, compagni, note logistiche)
 * - `done`: resoconto (condizioni, racconto, foto)
 * Il percorso (`user_routes`) resta la geometria riusabile.
 */
export type OutingStatus = "planned" | "done";
export type OutingVisibility = "participants" | "public";
export type OutingStopRole = "start" | "end" | "stop";

export const OUTING_STOP_KINDS = [
  "parking",
  "transport",
  "hut",
  "bivouac",
  "lodging",
  "restaurant",
  "supermarket",
  "water",
  "viewpoint",
  "other",
] as const;
export type OutingStopKind = (typeof OUTING_STOP_KINDS)[number];

export const OUTING_STOP_KIND_META: Record<OutingStopKind, { label: string; icon: string; color: string }> = {
  parking: { label: "Parcheggio", icon: "🅿️", color: "#94a3b8" },
  transport: { label: "Trasporti", icon: "🚌", color: "#64748b" },
  hut: { label: "Rifugio", icon: "🏠", color: "#ef4444" },
  bivouac: { label: "Bivacco", icon: "⛺", color: "#f97316" },
  lodging: { label: "Pernotto", icon: "🛏️", color: "#a78bfa" },
  restaurant: { label: "Ristorante / bar", icon: "🍽️", color: "#fb923c" },
  supermarket: { label: "Supermercato", icon: "🛒", color: "#22c55e" },
  water: { label: "Acqua", icon: "💧", color: "#38bdf8" },
  viewpoint: { label: "Punto notevole", icon: "📍", color: "#f59e0b" },
  other: { label: "Altro", icon: "•", color: "#cbd5e1" },
};

export function isOutingStopKind(raw: unknown): raw is OutingStopKind {
  return typeof raw === "string" && (OUTING_STOP_KINDS as readonly string[]).includes(raw);
}

/** Kind di `outdoor_features` → tipo sosta. */
export function stopKindFromOutdoorKind(kind: string): OutingStopKind {
  switch (kind) {
    case "parking":
      return "parking";
    case "bus_stop":
    case "train_station":
    case "aerialway_station":
    case "trailhead":
      return "transport";
    case "alpine_hut":
    case "refuges_info":
    case "alpine_farm":
    case "chalet":
      return "hut";
    case "wilderness_hut":
    case "shelter":
    case "shelter_basic":
    case "lean_to":
      return "bivouac";
    case "camp_site":
    case "hotel":
      return "lodging";
    case "restaurant":
    case "cafe":
      return "restaurant";
    case "shop_supermarket":
      return "supermarket";
    case "drinking_water":
    case "spring":
    case "fountain":
    case "water_point":
    case "water_tap":
      return "water";
    case "peak":
    case "saddle":
    case "mountain_pass":
    case "viewpoint":
      return "viewpoint";
    default:
      return "other";
  }
}

/** Categoria/sub_kind di `osm_poi` (ricerca POI) → tipo sosta. */
export function stopKindFromPoiCategory(category: string, subKind = ""): OutingStopKind {
  switch (category) {
    case "water":
      return "water";
    case "hut":
      return /wilderness|shelter|bivouac/.test(subKind) ? "bivouac" : "hut";
    case "lodging":
    case "campsite":
      return "lodging";
    case "shop":
      return "supermarket";
    case "restaurant":
      return "restaurant";
    case "bus":
      return "transport";
    default:
      return "other";
  }
}

export type OutingStopDto = {
  role: OutingStopRole;
  kind: OutingStopKind;
  name: string;
  lng: number;
  lat: number;
  along_km: number | null;
  ref: string | null;
  note: string;
  /** Si dorme qui: la sosta chiude una tappa (gita di più giorni). */
  overnight?: boolean;
};

/** Numero di giorni della gita: un giorno più uno per ogni pernotto. */
export function outingDays(stops: readonly Pick<OutingStopDto, "role" | "overnight">[]): number {
  return 1 + stops.filter((s) => s.role === "stop" && s.overnight).length;
}

/* ---------------- Condizioni (resoconto) ---------------- */

export type OutingConditionField = "snow" | "weather" | "access" | "trail";

export const SNOW_QUALITIES = ["powder", "spring", "crust", "wet", "wind", "ice", "mixed"] as const;
export type SnowQuality = (typeof SNOW_QUALITIES)[number];
export const SNOW_QUALITY_LABELS: Record<SnowQuality, string> = {
  powder: "Polvere",
  spring: "Trasformata / firn",
  crust: "Crosta",
  wet: "Bagnata / pesante",
  wind: "Ventata",
  ice: "Dura / ghiacciata",
  mixed: "Variabile",
};

export const WEATHER_SKIES = ["clear", "partly", "cloudy", "fog", "rain", "snow"] as const;
export type WeatherSky = (typeof WEATHER_SKIES)[number];
export const WEATHER_SKY_LABELS: Record<WeatherSky, string> = {
  clear: "Sereno",
  partly: "Variabile",
  cloudy: "Coperto",
  fog: "Nebbia",
  rain: "Pioggia",
  snow: "Neve",
};

export const WINDS = ["calm", "moderate", "strong"] as const;
export type Wind = (typeof WINDS)[number];
export const WIND_LABELS: Record<Wind, string> = { calm: "Calmo", moderate: "Moderato", strong: "Forte" };

export const TRAIL_STATES = ["good", "fair", "poor", "closed"] as const;
export type TrailState = (typeof TRAIL_STATES)[number];
export const TRAIL_STATE_LABELS: Record<TrailState, string> = {
  good: "Buono",
  fair: "Discreto",
  poor: "Difficile",
  closed: "Impraticabile",
};

export type OutingConditions = {
  snow?: { quality?: SnowQuality; from_ele_m?: number; note?: string };
  weather?: { sky?: WeatherSky; wind?: Wind; note?: string };
  access?: { ok?: boolean; note?: string };
  trail?: { state?: TrailState; note?: string };
  /** 1–5 */
  rating?: number;
};

export const CONDITION_FIELD_LABELS: Record<OutingConditionField, string> = {
  snow: "Neve",
  weather: "Meteo",
  access: "Strade di accesso",
  trail: "Fondo / sentiero",
};

function pick<T extends string>(list: readonly T[], v: unknown): T | undefined {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

function note(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, 1000);
  return t || undefined;
}

function compact<T extends object>(o: T): T | undefined {
  const entries = Object.entries(o).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

/** Normalizza condizioni da input non fidato (JSON string o oggetto). Ritorna null se vuote. */
export function parseOutingConditions(raw: unknown): OutingConditions | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, Record<string, unknown> | undefined> & { rating?: unknown };
  const obj = (x: unknown) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});

  const s = obj(o.snow);
  const ele = Number(s.from_ele_m);
  const w = obj(o.weather);
  const a = obj(o.access);
  const t = obj(o.trail);
  const rating = Number(o.rating);

  const out: OutingConditions = {
    snow: compact({
      quality: pick(SNOW_QUALITIES, s.quality),
      from_ele_m: s.from_ele_m != null && s.from_ele_m !== "" && Number.isFinite(ele) && ele >= 0 && ele < 9000 ? Math.round(ele) : undefined,
      note: note(s.note),
    }),
    weather: compact({ sky: pick(WEATHER_SKIES, w.sky), wind: pick(WINDS, w.wind), note: note(w.note) }),
    access: compact({ ok: typeof a.ok === "boolean" ? a.ok : undefined, note: note(a.note) }),
    trail: compact({ state: pick(TRAIL_STATES, t.state), note: note(t.note) }),
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
  };
  return compact(out) ?? null;
}

/** Riassunto testuale breve delle condizioni (liste, card). */
export function summarizeConditions(c: OutingConditions | null): string {
  if (!c) return "";
  const parts: string[] = [];
  if (c.snow?.quality) parts.push(`Neve: ${SNOW_QUALITY_LABELS[c.snow.quality].toLowerCase()}`);
  if (c.snow?.from_ele_m != null) parts.push(`neve da ${c.snow.from_ele_m} m`);
  if (c.weather?.sky) parts.push(WEATHER_SKY_LABELS[c.weather.sky]);
  if (c.access?.ok === true) parts.push("accesso ok");
  if (c.access?.ok === false) parts.push("accesso problematico");
  if (c.trail?.state) parts.push(`fondo ${TRAIL_STATE_LABELS[c.trail.state].toLowerCase()}`);
  return parts.join(" · ");
}

/* ---------------- DTO ---------------- */

export type OutingPhotoDto = {
  id: string;
  url: string;
  caption: string;
  lng: number;
  lat: number;
  owner: string;
};

export type OutingDto = {
  id: string;
  route_id: string;
  route_name: string | null;
  owner: string;
  title: string;
  outing_date: string | null;
  start_time: string | null;
  status: OutingStatus;
  visibility: OutingVisibility;
  /** Note logistiche del piano. */
  notes: string;
  /** Racconto della gita fatta. */
  story: string;
  conditions: OutingConditions | null;
  activity: UserRouteActivity;
  created_at: number;
  updated_at: number;
  participants: string[];
  group_ids: string[];
  stops: OutingStopDto[];
  photos: OutingPhotoDto[];
};

export const OUTING_STATUS_LABELS: Record<OutingStatus, string> = {
  planned: "In programma",
  done: "Fatta",
};

export function formatOutingDate(iso: string | null): string {
  if (!iso) return "Data non indicata";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Gita in programma con data ormai passata: va chiesto il resoconto. */
export function outingNeedsReport(o: Pick<OutingDto, "status" | "outing_date">, today = new Date()): boolean {
  if (o.status !== "planned" || !o.outing_date) return false;
  return o.outing_date <= today.toISOString().slice(0, 10);
}

/** Validazione orario "HH:MM". */
export function normalizeStartTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Validazione data "YYYY-MM-DD". */
export function normalizeOutingDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return Number.isNaN(new Date(`${t}T12:00:00`).getTime()) ? null : t;
}

/** Normalizza le soste da input non fidato. Max 60. */
export function parseOutingStops(raw: unknown): OutingStopDto[] {
  if (!Array.isArray(raw)) return [];
  const out: OutingStopDto[] = [];
  for (const it of raw.slice(0, 60)) {
    if (!it || typeof it !== "object") continue;
    const s = it as Record<string, unknown>;
    const lng = Number(s.lng);
    const lat = Number(s.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) continue;
    const role: OutingStopRole = s.role === "start" || s.role === "end" ? s.role : "stop";
    const along = Number(s.along_km);
    out.push({
      role,
      kind: isOutingStopKind(s.kind) ? s.kind : role === "start" || role === "end" ? "parking" : "other",
      name: typeof s.name === "string" ? s.name.trim().slice(0, 120) : "",
      lng,
      lat,
      along_km: s.along_km != null && Number.isFinite(along) ? Math.round(along * 100) / 100 : null,
      ref: typeof s.ref === "string" && s.ref.trim() ? s.ref.trim().slice(0, 120) : null,
      note: typeof s.note === "string" ? s.note.trim().slice(0, 500) : "",
      overnight: role === "stop" && s.overnight === true,
    });
  }
  // Una sola partenza e un solo arrivo; partenza in testa, arrivo in coda, soste per km.
  const start = out.find((s) => s.role === "start");
  const end = out.find((s) => s.role === "end");
  const mid = out
    .filter((s) => s.role === "stop")
    .sort((a, b) => (a.along_km ?? Infinity) - (b.along_km ?? Infinity));
  return [...(start ? [start] : []), ...mid, ...(end ? [end] : [])];
}
