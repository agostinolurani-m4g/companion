export interface WeatherDay {
  date: string;
  precip_mm_max: number;
  wind_speed_max_ms: number;
  temp_min_c: number;
  temp_max_c: number;
}

export interface WeatherResponse {
  latitude: number;
  longitude: number;
  daily: WeatherDay[];
}

const DAILY_VARS =
  "precipitation_sum,wind_speed_10m_max,temperature_2m_min,temperature_2m_max";

type OmDaily = {
  time: string[];
  precipitation_sum: (number | null)[];
  wind_speed_10m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  temperature_2m_max: (number | null)[];
};

function parseOmBody(j: {
  error?: boolean;
  reason?: string;
  latitude?: number;
  longitude?: number;
  daily?: OmDaily;
}): { latitude: number; longitude: number; daily: WeatherDay[] } {
  if (j.error || !j.daily?.time?.length) {
    const reason = typeof j.reason === "string" ? j.reason : "risposta senza serie giornaliere";
    throw new Error(`Open-Meteo: ${reason}`);
  }
  const lat = j.latitude ?? 0;
  const lng = j.longitude ?? 0;
  const daily: WeatherDay[] = j.daily.time.map((date, i) => ({
    date,
    precip_mm_max: j.daily!.precipitation_sum[i] ?? 0,
    /** Con wind_speed_unit=ms i valori sono già in m/s */
    wind_speed_max_ms: j.daily!.wind_speed_10m_max[i] ?? 0,
    temp_min_c: j.daily!.temperature_2m_min[i] ?? 0,
    temp_max_c: j.daily!.temperature_2m_max[i] ?? 0,
  }));
  return { latitude: lat, longitude: lng, daily };
}

function buildSearchParams(lat: number, lng: number, startDate: string, endDate: string) {
  const p = new URLSearchParams();
  p.set("latitude", String(lat));
  p.set("longitude", String(lng));
  p.set("daily", DAILY_VARS);
  p.set("timezone", "auto");
  p.set("start_date", startDate);
  p.set("end_date", endDate);
  p.set("wind_speed_unit", "ms");
  return p;
}

function utcTodayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function prevDayYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { next: { revalidate: 300 } });
  const j = (await res.json()) as Record<string, unknown>;
  if (j.error === true) {
    const reason = typeof j.reason === "string" ? j.reason : "errore API";
    throw new Error(`Open-Meteo: ${reason}`);
  }
  if (!res.ok) {
    const reason = typeof j.reason === "string" ? j.reason : `HTTP ${res.status}`;
    throw new Error(`Open-Meteo: ${reason}`);
  }
  return j;
}

async function fetchForecastSlice(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string
): Promise<{ latitude: number; longitude: number; daily: WeatherDay[] }> {
  const p = buildSearchParams(lat, lng, startDate, endDate);
  const url = `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
  const j = (await fetchJson(url)) as Parameters<typeof parseOmBody>[0];
  return parseOmBody(j);
}

async function fetchArchiveSlice(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string
): Promise<{ latitude: number; longitude: number; daily: WeatherDay[] }> {
  const p = buildSearchParams(lat, lng, startDate, endDate);
  const url = `https://archive-api.open-meteo.com/v1/archive?${p.toString()}`;
  const j = (await fetchJson(url)) as Parameters<typeof parseOmBody>[0];
  return parseOmBody(j);
}

function mergeByDate(a: WeatherDay[], b: WeatherDay[]): WeatherDay[] {
  const map = new Map<string, WeatherDay>();
  for (const x of a) map.set(x.date, x);
  for (const x of b) map.set(x.date, x);
  return [...map.keys()].sort().map((k) => map.get(k)!);
}

/**
 * Meteo giornaliero: l’endpoint **forecast** di Open-Meteo non gestisce bene intervalli solo nel passato
 * (risponde spesso con `error: true`). Per date passate usiamo **archive-api**; se l’itinerario attraversa
 * «oggi» uniamo archivio + forecast.
 */
export async function fetchOpenMeteoForecast(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string
): Promise<WeatherResponse> {
  if (startDate > endDate) {
    throw new Error("Intervallo date non valido (start > end)");
  }

  const today = utcTodayYmd();

  /** Intervallo interamente nel passato → storico. */
  if (endDate < today) {
    const r = await fetchArchiveSlice(lat, lng, startDate, endDate);
    return { latitude: r.latitude, longitude: r.longitude, daily: r.daily };
  }

  /** Da oggi in avanti → solo previsione. */
  if (startDate >= today) {
    const r = await fetchForecastSlice(lat, lng, startDate, endDate);
    return { latitude: r.latitude, longitude: r.longitude, daily: r.daily };
  }

  /** Inizia nel passato e finisce oggi o dopo: archivio fino a ieri + forecast da oggi. */
  const pastEnd = prevDayYmd(today);
  const past = await fetchArchiveSlice(lat, lng, startDate, pastEnd);
  const fut = await fetchForecastSlice(lat, lng, today, endDate);
  const daily = mergeByDate(past.daily, fut.daily);
  return { latitude: past.latitude, longitude: past.longitude, daily };
}
