/**
 * Meteo di precisione per punti di un itinerario (partenza, punto più alto,
 * pernotti): previsione oraria alla quota reale del punto + confronto tra
 * modelli ad alta risoluzione per temperatura e umidità. Parte pura (tipi,
 * parsing Open-Meteo, riassunti): usabile sia dal server sia dal client.
 */
import { sleepingBagComfortC, summarizeThermal, type DayThermal } from "@/lib/thermal";

/** Modelli confrontati: i primi sono ad area limitata (1–2 km, 2–5 giorni), gli ultimi globali. */
export const PRECISION_MODELS = [
  { id: "meteoswiss_icon_ch1", label: "ICON-CH1 · MeteoSvizzera 1 km" },
  { id: "meteofrance_arome_france_hd", label: "AROME HD · Météo-France 1,5 km" },
  { id: "icon_d2", label: "ICON-D2 · DWD 2 km" },
  { id: "italia_meteo_arpae_icon_2i", label: "ICON-2I · ItaliaMeteo 2 km" },
  { id: "icon_eu", label: "ICON-EU · DWD 7 km" },
  { id: "ecmwf_ifs025", label: "IFS · ECMWF 25 km" },
] as const;

export const PLAN_MAX_POINTS = 12;
export const PLAN_MAX_DAYS = 10;
/** Orizzonte massimo di Open-Meteo (giorni da oggi). */
export const FORECAST_HORIZON_DAYS = 15;

export type PlanPointKind = "start" | "high" | "camp" | "end";

export type PlanPointRequest = {
  id: string;
  label: string;
  kind: PlanPointKind;
  /** Giorno dell'itinerario (1 = primo). */
  day: number;
  lat: number;
  lng: number;
  ele: number | null;
};

export type PrecisionHour = {
  /** Ora locale del punto, `YYYY-MM-DDTHH:MM`. */
  time: string;
  temperature_c: number;
  humidity_pct: number | null;
  dew_point_c: number | null;
  apparent_c: number | null;
  wind_kmh: number | null;
  gust_kmh: number | null;
  wind_dir: number | null;
  precipitation_mm: number;
  precip_prob_pct: number | null;
  cloud_pct: number | null;
  freezing_level_m: number | null;
  uv_index: number | null;
  snowfall_cm: number | null;
  weather_code: number | null;
  /** Minimo e massimo tra i modelli disponibili a quell'ora (null se nessuno). */
  t_min_c: number | null;
  t_max_c: number | null;
  rh_min_pct: number | null;
  rh_max_pct: number | null;
  models_n: number;
};

export type PlanPointForecast = PlanPointRequest & {
  /** Quota a cui il modello è stato riportato (quella del punto, se nota). */
  model_elevation_m: number | null;
  hourly: PrecisionHour[];
  /** Modelli che hanno dati per questo punto, con le ore coperte. */
  models: { id: string; label: string; hours: number }[];
};

export type PlanForecast = {
  status: "ok" | "out_of_range";
  message: string | null;
  fetched_at: number;
  start_date: string;
  end_date: string;
  points: PlanPointForecast[];
  /** Alba/tramonto (ISO UTC, null oltre i circoli polari) per ogni giorno, al primo punto. */
  daylight: { date: string; sunrise: string | null; sunset: string | null; daylight_hours: number }[];
};

export const PRECISION_HOURLY_VARS = [
  "temperature_2m",
  "relative_humidity_2m",
  "dew_point_2m",
  "apparent_temperature",
  "precipitation",
  "precipitation_probability",
  "cloud_cover",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "freezing_level_height",
  "uv_index",
  "snowfall",
  "weather_code",
] as const;

type OpenMeteoHourly = { time?: string[] } & Record<string, (number | null)[] | string[] | undefined>;
export type OpenMeteoPrecisionJson = { elevation?: number; hourly?: OpenMeteoHourly };

function baseParams(lat: number, lng: number, ele: number | null, startDate: string, endDate: string): URLSearchParams {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    timezone: "auto",
    start_date: startDate,
    end_date: endDate,
  });
  if (ele != null && Number.isFinite(ele)) p.set("elevation", String(Math.round(ele)));
  return p;
}

/** Previsione completa (modello migliore per la zona, corretta alla quota). */
export function precisionUrl(lat: number, lng: number, ele: number | null, startDate: string, endDate: string): string {
  const p = baseParams(lat, lng, ele, startDate, endDate);
  p.set("hourly", PRECISION_HOURLY_VARS.join(","));
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

/** Solo temperatura e umidità, per ogni modello di `PRECISION_MODELS`. */
export function modelSpreadUrl(lat: number, lng: number, ele: number | null, startDate: string, endDate: string): string {
  const p = baseParams(lat, lng, ele, startDate, endDate);
  p.set("hourly", "temperature_2m,relative_humidity_2m");
  p.set("models", PRECISION_MODELS.map((m) => m.id).join(","));
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

function numAt(h: OpenMeteoHourly, key: string, i: number): number | null {
  const v = (h[key] as (number | null)[] | undefined)?.[i];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Ore dal JSON della previsione completa; le ore senza temperatura vengono scartate. */
export function parsePrecisionHourly(j: OpenMeteoPrecisionJson): { hourly: PrecisionHour[]; elevation: number | null } {
  const h = j.hourly;
  const elevation = typeof j.elevation === "number" ? j.elevation : null;
  if (!h?.time) return { hourly: [], elevation };
  const hourly: PrecisionHour[] = [];
  h.time.forEach((time, i) => {
    const t = numAt(h, "temperature_2m", i);
    if (t == null) return;
    hourly.push({
      time,
      temperature_c: t,
      humidity_pct: numAt(h, "relative_humidity_2m", i),
      dew_point_c: numAt(h, "dew_point_2m", i),
      apparent_c: numAt(h, "apparent_temperature", i),
      wind_kmh: numAt(h, "wind_speed_10m", i),
      gust_kmh: numAt(h, "wind_gusts_10m", i),
      wind_dir: numAt(h, "wind_direction_10m", i),
      precipitation_mm: numAt(h, "precipitation", i) ?? 0,
      precip_prob_pct: numAt(h, "precipitation_probability", i),
      cloud_pct: numAt(h, "cloud_cover", i),
      freezing_level_m: numAt(h, "freezing_level_height", i),
      uv_index: numAt(h, "uv_index", i),
      snowfall_cm: numAt(h, "snowfall", i),
      weather_code: numAt(h, "weather_code", i),
      t_min_c: null,
      t_max_c: null,
      rh_min_pct: null,
      rh_max_pct: null,
      models_n: 0,
    });
  });
  return { hourly, elevation };
}

/**
 * Aggiunge alle ore min/max tra i modelli (chiavi `temperature_2m_<modello>`).
 * I modelli ad area limitata sono null fuori dominio o oltre il loro orizzonte.
 */
export function mergeModelSpread(
  hours: PrecisionHour[],
  j: OpenMeteoPrecisionJson,
): { hourly: PrecisionHour[]; models: PlanPointForecast["models"] } {
  const h = j.hourly;
  if (!h?.time) return { hourly: hours, models: [] };
  const index = new Map(h.time.map((t, i) => [t, i]));
  const covered = new Map<string, number>();
  const hourly = hours.map((row) => {
    const i = index.get(row.time);
    if (i == null) return row;
    let tMin: number | null = null;
    let tMax: number | null = null;
    let rhMin: number | null = null;
    let rhMax: number | null = null;
    let n = 0;
    for (const m of PRECISION_MODELS) {
      const t = numAt(h, `temperature_2m_${m.id}`, i);
      const rh = numAt(h, `relative_humidity_2m_${m.id}`, i);
      if (t == null) continue;
      n++;
      covered.set(m.id, (covered.get(m.id) ?? 0) + 1);
      if (tMin == null || t < tMin) tMin = t;
      if (tMax == null || t > tMax) tMax = t;
      if (rh != null) {
        if (rhMin == null || rh < rhMin) rhMin = rh;
        if (rhMax == null || rh > rhMax) rhMax = rh;
      }
    }
    return { ...row, t_min_c: tMin, t_max_c: tMax, rh_min_pct: rhMin, rh_max_pct: rhMax, models_n: n };
  });
  const models = PRECISION_MODELS.filter((m) => covered.has(m.id)).map((m) => ({
    id: m.id,
    label: m.label,
    hours: covered.get(m.id) as number,
  }));
  return { hourly, models };
}

/* ------------------------------------------------------------------ */
/* Riassunti                                                           */
/* ------------------------------------------------------------------ */

export type ModelAgreement = "high" | "medium" | "low";

export const MODEL_AGREEMENT_LABELS: Record<ModelAgreement, string> = {
  high: "Modelli concordi",
  medium: "Modelli in parte discordi",
  low: "Modelli discordi",
};

/** Accordo tra modelli dallo scarto massimo di temperatura (°C). */
export function modelAgreement(spreadC: number | null): ModelAgreement | null {
  if (spreadC == null) return null;
  return spreadC <= 2 ? "high" : spreadC <= 4 ? "medium" : "low";
}

export type WindowSummary = DayThermal & {
  hours: number;
  precipitation_mm: number;
  precip_prob_max_pct: number | null;
  snowfall_cm: number;
  wind_max_kmh: number | null;
  gust_max_kmh: number | null;
  freezing_level_min_m: number | null;
  freezing_level_max_m: number | null;
  uv_max: number | null;
  cloud_avg_pct: number | null;
  /** Scarto massimo tra modelli nella finestra. */
  spread_t_c: number | null;
  spread_rh_pct: number | null;
  /** Estremi tra tutti i modelli (più larghi di temp_min/max del modello principale). */
  t_low_c: number | null;
  t_high_c: number | null;
  models_n: number;
};

function hourOf(time: string): number {
  return Number(time.slice(11, 13));
}

/** Ore di `date` tra `fromHour` (incluso) e `toHour` (escluso). */
export function hoursInDay(hours: PrecisionHour[], date: string, fromHour = 0, toHour = 24): PrecisionHour[] {
  return hours.filter((h) => h.time.slice(0, 10) === date && hourOf(h.time) >= fromHour && hourOf(h.time) < toHour);
}

/** Ore della notte che segue `date`: dalle 20 alle 8 del giorno dopo. */
export function nightHours(hours: PrecisionHour[], date: string, nextDate: string): PrecisionHour[] {
  return hours.filter(
    (h) =>
      (h.time.slice(0, 10) === date && hourOf(h.time) >= 20) ||
      (h.time.slice(0, 10) === nextDate && hourOf(h.time) < 8),
  );
}

export function summarizeWindow(hours: PrecisionHour[]): WindowSummary | null {
  if (hours.length === 0) return null;
  const thermal = summarizeThermal(
    hours.map((h) => ({
      time: h.time,
      temperature_c: h.temperature_c,
      humidity_pct: h.humidity_pct,
      wind_kmh: h.wind_kmh,
      gust_kmh: h.gust_kmh,
      precipitation_mm: h.precipitation_mm,
    })),
  );
  const max = (pick: (h: PrecisionHour) => number | null): number | null => {
    let m: number | null = null;
    for (const h of hours) {
      const v = pick(h);
      if (v != null && (m == null || v > m)) m = v;
    }
    return m;
  };
  const min = (pick: (h: PrecisionHour) => number | null): number | null => {
    let m: number | null = null;
    for (const h of hours) {
      const v = pick(h);
      if (v != null && (m == null || v < m)) m = v;
    }
    return m;
  };
  const clouds = hours.map((h) => h.cloud_pct).filter((v): v is number => v != null);
  return {
    ...thermal,
    hours: hours.length,
    precipitation_mm: Math.round(hours.reduce((s, h) => s + h.precipitation_mm, 0) * 10) / 10,
    precip_prob_max_pct: max((h) => h.precip_prob_pct),
    snowfall_cm: Math.round(hours.reduce((s, h) => s + (h.snowfall_cm ?? 0), 0) * 10) / 10,
    wind_max_kmh: max((h) => h.wind_kmh),
    gust_max_kmh: max((h) => h.gust_kmh),
    freezing_level_min_m: min((h) => h.freezing_level_m),
    freezing_level_max_m: max((h) => h.freezing_level_m),
    uv_max: max((h) => h.uv_index),
    cloud_avg_pct: clouds.length ? Math.round(clouds.reduce((a, b) => a + b, 0) / clouds.length) : null,
    spread_t_c: max((h) => (h.t_min_c != null && h.t_max_c != null ? Math.round((h.t_max_c - h.t_min_c) * 10) / 10 : null)),
    spread_rh_pct: max((h) => (h.rh_min_pct != null && h.rh_max_pct != null ? Math.round(h.rh_max_pct - h.rh_min_pct) : null)),
    t_low_c: min((h) => (h.t_min_c != null ? Math.min(h.t_min_c, h.temperature_c) : h.temperature_c)),
    t_high_c: max((h) => (h.t_max_c != null ? Math.max(h.t_max_c, h.temperature_c) : h.temperature_c)),
    models_n: max((h) => h.models_n) ?? 0,
  };
}

export type NightSummary = WindowSummary & {
  /** Comfort minimo consigliato per il sacco a pelo (caso peggiore tra i modelli). */
  bag_comfort_c: number;
};

/** Notte al pernotto: minima (la più bassa tra i modelli), percepita, umidità, sacco consigliato. */
export function summarizeNight(hours: PrecisionHour[], date: string, nextDate: string, exposed: boolean): NightSummary | null {
  const w = summarizeWindow(nightHours(hours, date, nextDate));
  if (!w || w.t_low_c == null) return null;
  return { ...w, bag_comfort_c: sleepingBagComfortC(w.t_low_c, exposed) };
}
