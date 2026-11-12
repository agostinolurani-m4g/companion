import { getConditionsCache, setConditionsCache } from "@/lib/db";
import { findEawsRegion } from "@/lib/avalanche-bulletin";
import { isUserRouteActivity, SPORTS, type UserRouteActivity } from "@/lib/sports";

export const FORECAST_DAYS = 3;

export type HourlyWeather = {
  time: string;
  temperature_c: number;
  precipitation_mm: number;
  wind_gust_kmh: number;
  cape: number;
  lightning_index: number;
  wind_speed_kmh?: number | null;
  weather_code?: number | null;
  /** Solo sport invernali (`avalanche_detail` in `conditionWidgets`). */
  freezing_level_m?: number | null;
  snowfall_cm?: number | null;
  snow_depth_cm?: number | null;
  /** Vento a 700 hPa (~3000 m). */
  wind_700hpa_kmh?: number | null;
  wind_700hpa_dir?: number | null;
};

export type DailyWeather = {
  date: string;
  temp_min_c: number | null;
  temp_max_c: number | null;
  precipitation_mm: number;
  gust_max_kmh: number | null;
  snowfall_cm: number | null;
  snow_depth_max_cm: number | null;
  freezing_level_min_m: number | null;
  freezing_level_max_m: number | null;
  wind_700hpa_max_kmh: number | null;
};

export type PointForecast = {
  role: "start" | "summit";
  lat: number;
  lng: number;
  /** Quota richiesta (dal percorso) o null se si usa il DEM di Open-Meteo. */
  requested_elevation_m: number | null;
  /** Quota effettivamente usata dal modello. */
  model_elevation_m: number | null;
  hourly: HourlyWeather[];
  daily: DailyWeather[];
  thunderstorm_risk: number;
};

export type WeatherAlert = {
  level: 2 | 3 | 4;
  color: "yellow" | "orange" | "red";
  type: string;
  title: string;
  description: string | null;
  area: string;
  onset: string | null;
  expires: string | null;
  sent: string | null;
  web: string | null;
};

export type AlertsInfo = {
  status: "ok" | "unavailable";
  area: string | null;
  source: string;
  message: string | null;
  disclaimer: string | null;
};

export type ConditionsPayload = {
  lat: number;
  lng: number;
  fetched_at: number;
  /** Partenza (compatibilità con i chiamanti esistenti). */
  hourly: HourlyWeather[];
  /** Massimo tra partenza e punto più alto. */
  thunderstorm_risk: number;
  daylight: { sunrise: string; sunset: string; daylight_hours: number };
  /** Titoli delle allerte attive nell'area del punto (compatibilità). */
  meteo_alarm: string[];
  forecast_days: number;
  winter: boolean;
  start: PointForecast;
  summit: PointForecast | null;
  alerts: WeatherAlert[];
  alerts_info: AlertsInfo;
};

export type ConditionsRequest = {
  lat: number;
  lng: number;
  startEle?: number | null;
  summit?: { lat: number; lng: number; ele?: number | null } | null;
  activity?: UserRouteActivity | string | null;
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const ALERTS_TTL_MS = 15 * 60 * 1000;
/** Sotto questo dislivello il punto più alto non aggiunge informazione. */
const SUMMIT_MIN_DELTA_M = 150;

function round2(v: number): number {
  return Math.round(v * 100);
}

export function pointCacheKey(lat: number, lng: number, ele: number | null, winter: boolean): string {
  return `cond:v2:${round2(lat)}:${round2(lng)}:${ele == null ? "dem" : Math.round(ele / 50) * 50}:${winter ? "w" : "s"}:${FORECAST_DAYS}`;
}

export function winterWidgetsFor(activity: string | null | undefined): boolean {
  if (!activity || !isUserRouteActivity(activity)) return false;
  return SPORTS[activity].conditionWidgets.includes("avalanche_detail");
}

function daylightHours(lat: number, lng: number, date = new Date()): ConditionsPayload["daylight"] {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d - 1524.5;
  const n = jd - 2451545.0 + 0.0008;
  const lonDeg = lng;
  const jTransit = 2451545.0 + n + 0.0053 * Math.sin((lonDeg * Math.PI) / 180) - 0.0069;
  const omega = 2 * Math.PI / 365.2422;
  const decl = 0.409 * Math.sin(omega * (n - 81));
  const latRad = (lat * Math.PI) / 180;
  const cosH = (Math.sin(-0.83 * (Math.PI / 180)) - Math.sin(latRad) * Math.sin(decl)) /
    (Math.cos(latRad) * Math.cos(decl));
  const H = Math.acos(Math.min(1, Math.max(-1, cosH)));
  const daylight_hours = (2 * H * 24) / (2 * Math.PI);
  const sunrise = new Date((jTransit - H / (2 * Math.PI)) * 86400000).toISOString();
  const sunset = new Date((jTransit + H / (2 * Math.PI)) * 86400000).toISOString();
  return { sunrise, sunset, daylight_hours: Math.round(daylight_hours * 10) / 10 };
}

export function thunderstormRiskFromHourly(hourly: HourlyWeather[]): number {
  if (hourly.length === 0) return 0;
  let max = 0;
  for (const h of hourly.slice(0, 12)) {
    const capeScore = Math.min(1, h.cape / 2500);
    const rainScore = Math.min(1, h.precipitation_mm / 8);
    const liScore = Math.min(1, h.lightning_index / 100);
    max = Math.max(max, capeScore * 0.4 + rainScore * 0.3 + liScore * 0.3);
  }
  return Math.round(max * 100);
}

function minMax(vals: (number | null | undefined)[]): [number | null, number | null] {
  let lo: number | null = null;
  let hi: number | null = null;
  for (const v of vals) {
    if (v == null || !Number.isFinite(v)) continue;
    if (lo == null || v < lo) lo = v;
    if (hi == null || v > hi) hi = v;
  }
  return [lo, hi];
}

/** Riassunto giornaliero dalle ore (data locale = primi 10 caratteri di `time`). */
export function dailyFromHourly(hourly: HourlyWeather[]): DailyWeather[] {
  const byDay = new Map<string, HourlyWeather[]>();
  for (const h of hourly) {
    const d = h.time.slice(0, 10);
    const arr = byDay.get(d);
    if (arr) arr.push(h);
    else byDay.set(d, [h]);
  }
  const out: DailyWeather[] = [];
  for (const [date, hs] of byDay) {
    const [tmin, tmax] = minMax(hs.map((h) => h.temperature_c));
    const [, gust] = minMax(hs.map((h) => h.wind_gust_kmh));
    const [flMin, flMax] = minMax(hs.map((h) => h.freezing_level_m));
    const [, w700] = minMax(hs.map((h) => h.wind_700hpa_kmh));
    const [, depth] = minMax(hs.map((h) => h.snow_depth_cm));
    const hasSnowfall = hs.some((h) => h.snowfall_cm != null);
    out.push({
      date,
      temp_min_c: tmin,
      temp_max_c: tmax,
      precipitation_mm: Math.round(hs.reduce((s, h) => s + (h.precipitation_mm || 0), 0) * 10) / 10,
      gust_max_kmh: gust,
      snowfall_cm: hasSnowfall ? Math.round(hs.reduce((s, h) => s + (h.snowfall_cm ?? 0), 0) * 10) / 10 : null,
      snow_depth_max_cm: depth,
      freezing_level_min_m: flMin,
      freezing_level_max_m: flMax,
      wind_700hpa_max_kmh: w700,
    });
  }
  return out;
}

type OpenMeteoJson = {
  elevation?: number;
  hourly?: Record<string, (number | null)[] | string[] | undefined> & { time?: string[] };
};

export function openMeteoUrl(lat: number, lng: number, ele: number | null, winter: boolean): string {
  const vars = ["temperature_2m", "precipitation", "wind_gusts_10m", "wind_speed_10m", "cape", "lightning_potential", "weather_code"];
  if (winter) vars.push("freezing_level_height", "snowfall", "snow_depth", "wind_speed_700hPa", "wind_direction_700hPa");
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: vars.join(","),
    timezone: "auto",
    forecast_days: String(FORECAST_DAYS),
  });
  if (ele != null && Number.isFinite(ele)) params.set("elevation", String(Math.round(ele)));
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export function parseOpenMeteo(j: OpenMeteoJson, winter: boolean): { hourly: HourlyWeather[]; elevation: number | null } {
  const h = j.hourly;
  if (!h?.time) return { hourly: [], elevation: j.elevation ?? null };
  const num = (k: string, i: number): number | null => {
    const v = (h[k] as (number | null)[] | undefined)?.[i];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const hourly = h.time.map((time, i) => {
    const row: HourlyWeather = {
      time,
      temperature_c: num("temperature_2m", i) ?? 0,
      precipitation_mm: num("precipitation", i) ?? 0,
      wind_gust_kmh: num("wind_gusts_10m", i) ?? 0,
      cape: num("cape", i) ?? 0,
      lightning_index: num("lightning_potential", i) ?? 0,
      wind_speed_kmh: num("wind_speed_10m", i),
      weather_code: num("weather_code", i),
    };
    if (winter) {
      row.freezing_level_m = num("freezing_level_height", i);
      row.snowfall_cm = num("snowfall", i);
      const depthM = num("snow_depth", i);
      row.snow_depth_cm = depthM == null ? null : Math.round(depthM * 100);
      row.wind_700hpa_kmh = num("wind_speed_700hPa", i);
      row.wind_700hpa_dir = num("wind_direction_700hPa", i);
    }
    return row;
  });
  return { hourly, elevation: j.elevation ?? null };
}

async function fetchPointForecast(
  role: PointForecast["role"],
  lat: number,
  lng: number,
  ele: number | null,
  winter: boolean,
): Promise<PointForecast> {
  const key = pointCacheKey(lat, lng, ele, winter);
  const cached = getConditionsCache(key);
  if (cached) {
    try {
      return { ...(JSON.parse(cached) as PointForecast), role };
    } catch {
      /* riscarica */
    }
  }
  const res = await fetch(openMeteoUrl(lat, lng, ele, winter), { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error("Open-Meteo non disponibile");
  const { hourly, elevation } = parseOpenMeteo((await res.json()) as OpenMeteoJson, winter);
  const pf: PointForecast = {
    role,
    lat,
    lng,
    requested_elevation_m: ele == null ? null : Math.round(ele),
    model_elevation_m: elevation == null ? null : Math.round(elevation),
    hourly,
    daily: dailyFromHourly(hourly),
    thunderstorm_risk: thunderstormRiskFromHourly(hourly),
  };
  setConditionsCache(key, JSON.stringify(pf), CACHE_TTL_MS);
  return pf;
}

/* ------------------------------------------------------------------ */
/* Allerte MeteoAlarm filtrate per regione (Italia)                    */
/* ------------------------------------------------------------------ */

const METEOALARM_IT_URL = "https://feeds.meteoalarm.org/api/v1/warnings/feeds-italy";

/**
 * Prefisso regione EAWS (ISO 3166-2:IT) → EMMA_ID MeteoAlarm. Coppie verificate sul feed reale
 * (areaDesc di ogni EMMA_ID). Valle d'Aosta (IT-23) non compare nel feed: nessuna allerta.
 */
export const EAWS_TO_EMMA: Record<string, { emma: string; area: string }> = {
  "IT-21": { emma: "IT005", area: "Piemonte" },
  "IT-25": { emma: "IT003", area: "Lombardia" },
  "IT-32": { emma: "IT002", area: "Trentino Alto Adige" },
  "IT-34": { emma: "IT006", area: "Veneto" },
  "IT-36": { emma: "IT020", area: "Friuli Venezia Giulia" },
  "IT-57": { emma: "IT011", area: "Marche" },
};

export function emmaForEawsRegion(regionId: string | null | undefined): { emma: string; area: string } | null {
  if (!regionId) return null;
  const m = regionId.match(/^(IT-\d{2})-/);
  return m ? (EAWS_TO_EMMA[m[1]] ?? null) : null;
}

const AWARENESS_TYPE_IT: Record<string, string> = {
  "1": "Vento",
  "2": "Neve/ghiaccio",
  "3": "Temporali",
  "4": "Nebbia",
  "5": "Temperature elevate",
  "6": "Temperature basse",
  "7": "Eventi costieri",
  "8": "Incendi boschivi",
  "9": "Valanghe",
  "10": "Pioggia",
  "12": "Alluvioni",
  "13": "Pioggia/alluvione",
};

const COLOR_IT: Record<WeatherAlert["color"], string> = { yellow: "gialla", orange: "arancione", red: "rossa" };

type MaInfo = {
  language?: string;
  area?: { areaDesc?: string; geocode?: { value?: string; valueName?: string }[] }[];
  description?: string;
  onset?: string;
  expires?: string;
  parameter?: { value?: string; valueName?: string }[];
  web?: string;
};
type MaWarning = {
  alert?: { identifier?: string; msgType?: string; status?: string; sent?: string; references?: string; info?: MaInfo[] };
};

export type RegionalAlert = WeatherAlert & { emma: string; identifier: string };

/**
 * Allerte attive (livello ≥ giallo, non scadute, non sostituite da un aggiornamento)
 * dal JSON MeteoAlarm, una per area EMMA.
 */
export function parseMeteoAlarmWarnings(json: unknown, now: number): RegionalAlert[] {
  const warnings = ((json ?? {}) as { warnings?: MaWarning[] }).warnings ?? [];
  const superseded = new Set<string>();
  for (const w of warnings) {
    for (const ref of (w.alert?.references ?? "").split(/\s+/)) {
      const id = ref.split(",")[1];
      if (id) superseded.add(id);
    }
  }
  const out: RegionalAlert[] = [];
  const seen = new Set<string>();
  for (const w of warnings) {
    const a = w.alert;
    if (!a?.identifier || a.status !== "Actual" || a.msgType === "Cancel" || superseded.has(a.identifier)) continue;
    const infos = a.info ?? [];
    const info = infos.find((i) => i.language?.toLowerCase().startsWith("it")) ?? infos[0];
    if (!info) continue;
    const expires = info.expires ? Date.parse(info.expires) : NaN;
    if (!Number.isFinite(expires) || expires <= now) continue;
    const param = (n: string) => info.parameter?.find((p) => p.valueName === n)?.value ?? "";
    const lvl = Number(param("awareness_level").split(";")[0]);
    if (!(lvl >= 2 && lvl <= 4)) continue;
    const color = (["yellow", "orange", "red"] as const)[lvl - 2];
    const typeCode = param("awareness_type").split(";")[0].trim();
    const type = AWARENESS_TYPE_IT[typeCode] ?? (param("awareness_type").split(";")[1]?.trim() || "Meteo");
    const description = info.description?.split(/\(DISCLAIMER/i)[0].replace(/\s+/g, " ").trim() || null;
    for (const area of info.area ?? []) {
      for (const g of area.geocode ?? []) {
        if (g.valueName !== "EMMA_ID" || !g.value) continue;
        const dedupe = `${g.value}|${typeCode}|${info.onset}|${info.expires}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push({
          emma: g.value,
          identifier: a.identifier,
          level: lvl as 2 | 3 | 4,
          color,
          type,
          title: `Allerta ${COLOR_IT[color]} · ${type}`,
          description,
          area: area.areaDesc ?? g.value,
          onset: info.onset ?? null,
          expires: info.expires ?? null,
          sent: a.sent ?? null,
          web: info.web ?? null,
        });
      }
    }
  }
  return out.sort((x, y) => y.level - x.level || (x.onset ?? "").localeCompare(y.onset ?? ""));
}

const ALERTS_SOURCE = "MeteoAlarm (Aeronautica Militare)";
const ALERTS_DISCLAIMER =
  "Avvisi MeteoAlarm riferiti all'intera regione: indicano intensità dei fenomeni, non sono le allerte ufficiali della Protezione Civile (protezionecivile.gov.it).";

async function loadItalianAlerts(now: number): Promise<RegionalAlert[] | null> {
  const key = "alerts:meteoalarm:it:v2";
  const cached = getConditionsCache(key);
  if (cached) {
    try {
      return (JSON.parse(cached) as RegionalAlert[]).filter((a) => !a.expires || Date.parse(a.expires) > now);
    } catch {
      /* riscarica */
    }
  }
  try {
    const res = await fetch(METEOALARM_IT_URL, {
      headers: { Accept: "application/json", "User-Agent": "hmr-companion/0.1" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const list = parseMeteoAlarmWarnings(await res.json(), now);
    setConditionsCache(key, JSON.stringify(list), ALERTS_TTL_MS);
    return list;
  } catch {
    return null;
  }
}

async function alertsForPoint(lat: number, lng: number, now: number): Promise<{ alerts: WeatherAlert[]; info: AlertsInfo }> {
  let regionId: string | null = null;
  try {
    regionId = findEawsRegion(lat, lng, now)?.id ?? null;
  } catch {
    regionId = null;
  }
  const area = emmaForEawsRegion(regionId);
  if (!area) {
    return {
      alerts: [],
      info: {
        status: "unavailable",
        area: null,
        source: ALERTS_SOURCE,
        message: "Allerte meteo non disponibili per questa zona (copertura: regioni alpine italiane, esclusa la Valle d'Aosta).",
        disclaimer: null,
      },
    };
  }
  const all = await loadItalianAlerts(now);
  if (all == null) {
    return {
      alerts: [],
      info: { status: "unavailable", area: area.area, source: ALERTS_SOURCE, message: "Servizio allerte non raggiungibile.", disclaimer: null },
    };
  }
  const alerts: WeatherAlert[] = all
    .filter((a) => a.emma === area.emma)
    .map((a) => ({
      level: a.level,
      color: a.color,
      type: a.type,
      title: a.title,
      description: a.description,
      area: a.area,
      onset: a.onset,
      expires: a.expires,
      sent: a.sent,
      web: a.web,
    }));
  return {
    alerts,
    info: { status: "ok", area: area.area, source: ALERTS_SOURCE, message: null, disclaimer: ALERTS_DISCLAIMER },
  };
}

/* ------------------------------------------------------------------ */

export async function fetchConditions(req: ConditionsRequest): Promise<ConditionsPayload> {
  const now = Date.now();
  const winter = winterWidgetsFor(req.activity ?? null);
  const startEle = req.startEle != null && Number.isFinite(req.startEle) ? req.startEle : null;
  const s = req.summit;
  const summitEle = s?.ele != null && Number.isFinite(s.ele) ? s.ele : null;
  const wantSummit =
    s != null &&
    summitEle != null &&
    (startEle == null || summitEle - startEle >= SUMMIT_MIN_DELTA_M);

  const [start, summit, alerts] = await Promise.all([
    fetchPointForecast("start", req.lat, req.lng, startEle, winter),
    wantSummit ? fetchPointForecast("summit", s.lat, s.lng, summitEle, winter).catch(() => null) : Promise.resolve(null),
    alertsForPoint(req.lat, req.lng, now),
  ]);

  return {
    lat: req.lat,
    lng: req.lng,
    fetched_at: now,
    hourly: start.hourly,
    thunderstorm_risk: Math.max(start.thunderstorm_risk, summit?.thunderstorm_risk ?? 0),
    daylight: daylightHours(req.lat, req.lng),
    meteo_alarm: alerts.alerts.map((a) => `${a.title} (${a.area})`),
    forecast_days: FORECAST_DAYS,
    winter,
    start,
    summit,
    alerts: alerts.alerts,
    alerts_info: alerts.info,
  };
}

/** Compatibilità: previsione nel solo punto indicato. */
export async function fetchConditionsForPoint(lat: number, lng: number): Promise<ConditionsPayload> {
  return fetchConditions({ lat, lng });
}

/** Partenza e punto più alto da coordinate `[lng, lat, ele?]`. */
export function startAndSummit(
  coords: readonly (readonly number[])[],
): { start: { lat: number; lng: number; ele: number | null }; summit: { lat: number; lng: number; ele: number } | null } | null {
  const valid = coords.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (valid.length === 0) return null;
  const first = valid[0];
  const start = { lng: first[0], lat: first[1], ele: Number.isFinite(first[2]) ? (first[2] as number) : null };
  let summit: { lat: number; lng: number; ele: number } | null = null;
  for (const c of valid) {
    const e = c[2];
    if (typeof e === "number" && Number.isFinite(e) && (!summit || e > summit.ele)) summit = { lng: c[0], lat: c[1], ele: e };
  }
  return { start, summit };
}
