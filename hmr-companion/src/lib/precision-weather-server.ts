import { getConditionsCache, setConditionsCache } from "@/lib/db";
import { addDaysIso } from "@/lib/multiday";
import {
  FORECAST_HORIZON_DAYS,
  mergeModelSpread,
  modelSpreadUrl,
  parsePrecisionHourly,
  PLAN_MAX_DAYS,
  PLAN_MAX_POINTS,
  precisionUrl,
  type OpenMeteoPrecisionJson,
  type PlanForecast,
  type PlanPointForecast,
  type PlanPointRequest,
} from "@/lib/precision-weather";
import { sunTimes } from "@/lib/sun";

const CACHE_TTL_MS = 30 * 60 * 1000;

async function getJson(url: string): Promise<OpenMeteoPrecisionJson> {
  let res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (res.status === 429 || res.status >= 500) {
    // Più punti partono insieme: un rifiuto momentaneo si risolve riprovando una volta.
    await new Promise((r) => setTimeout(r, 900));
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { reason?: string } | null;
    throw new Error(`Open-Meteo non disponibile (${res.status}${body?.reason ? `: ${body.reason}` : ""})`);
  }
  return (await res.json()) as OpenMeteoPrecisionJson;
}

async function fetchPoint(p: PlanPointRequest, startDate: string, endDate: string): Promise<PlanPointForecast> {
  const eleKey = p.ele == null ? "dem" : String(Math.round(p.ele / 50) * 50);
  const key = `prec:v1:${p.lat.toFixed(3)}:${p.lng.toFixed(3)}:${eleKey}:${startDate}:${endDate}`;
  const cached = getConditionsCache(key);
  if (cached) {
    try {
      const c = JSON.parse(cached) as Pick<PlanPointForecast, "model_elevation_m" | "hourly" | "models">;
      return { ...p, ...c };
    } catch {
      /* riscarica */
    }
  }
  const [main, spread] = await Promise.all([
    getJson(precisionUrl(p.lat, p.lng, p.ele, startDate, endDate)),
    // Il confronto tra modelli è un di più: se fallisce resta la previsione principale.
    getJson(modelSpreadUrl(p.lat, p.lng, p.ele, startDate, endDate)).catch(() => null),
  ]);
  const parsed = parsePrecisionHourly(main);
  const merged = spread ? mergeModelSpread(parsed.hourly, spread) : { hourly: parsed.hourly, models: [] };
  const payload = {
    model_elevation_m: parsed.elevation == null ? null : Math.round(parsed.elevation),
    hourly: merged.hourly,
    models: merged.models,
  };
  setConditionsCache(key, JSON.stringify(payload), CACHE_TTL_MS);
  return { ...p, ...payload };
}

export type PlanForecastRequest = {
  /** Primo giorno dell'itinerario; null o passato = da oggi. */
  startDate: string | null;
  days: number;
  points: PlanPointRequest[];
};

/** Previsione di precisione per i punti dell'itinerario, nei giorni indicati. */
export async function fetchPlanForecast(req: PlanForecastRequest, now = Date.now()): Promise<PlanForecast> {
  const today = new Date(now).toISOString().slice(0, 10);
  const horizon = addDaysIso(today, FORECAST_HORIZON_DAYS);
  const days = Math.min(PLAN_MAX_DAYS, Math.max(1, Math.floor(req.days) || 1));
  const start = req.startDate && req.startDate > today ? req.startDate : today;
  const points = req.points.slice(0, PLAN_MAX_POINTS);

  if (start > horizon) {
    return {
      status: "out_of_range",
      message: `Le previsioni arrivano fino al ${horizon}: per questa data saranno disponibili più avanti.`,
      fetched_at: now,
      start_date: start,
      end_date: addDaysIso(start, days - 1),
      points: [],
      daylight: [],
    };
  }
  const wantedEnd = addDaysIso(start, days);
  const end = wantedEnd > horizon ? horizon : wantedEnd;
  const forecasts = await Promise.all(points.map((p) => fetchPoint(p, start, end)));

  const first = points[0];
  const daylight: PlanForecast["daylight"] = [];
  if (first) {
    for (let d = start; d <= end; d = addDaysIso(d, 1)) {
      daylight.push({ date: d, ...sunTimes(first.lat, first.lng, d) });
    }
  }
  return {
    status: "ok",
    message: wantedEnd > horizon ? `Previsioni disponibili solo fino al ${horizon}: gli ultimi giorni mancano.` : null,
    fetched_at: now,
    start_date: start,
    end_date: end,
    points: forecasts,
    daylight,
  };
}
