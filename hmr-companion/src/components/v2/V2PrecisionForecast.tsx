"use client";

import { useEffect, useMemo, useState } from "react";
import { stageDayLabel } from "@/components/v2/V2StageList";
import { fetchJson } from "@/lib/fetch-json";
import { addDaysIso, addMinutesToTime, buildStages, type OvernightMark, type ProfilePoint, type Stage } from "@/lib/multiday";
import {
  hoursInDay,
  MODEL_AGREEMENT_LABELS,
  modelAgreement,
  summarizeNight,
  summarizeWindow,
  type PlanForecast,
  type PlanPointForecast,
  type PlanPointRequest,
  type WindowSummary,
} from "@/lib/precision-weather";
import { formatDuration } from "@/lib/route-time";
import type { UserRouteActivity } from "@/lib/sports";
import { waterLitersPerHour, type Hazard } from "@/lib/thermal";

type Props = {
  activity: UserRouteActivity;
  /** Primo giorno della gita (`YYYY-MM-DD`); null = da oggi. */
  date: string | null;
  /** Ora di partenza `HH:MM`, usata ogni giorno. */
  startTime?: string | null;
  /** Profilo `[lng, lat, quota, km]` della traccia. */
  profile: readonly ProfilePoint[];
  overnights?: readonly OvernightMark[];
};

/** Ore di giorno considerate per il riassunto di un punto. */
const DAY_FROM_H = 6;
const DAY_TO_H = 20;
/** Sotto questo dislivello il punto più alto non aggiunge informazione rispetto agli estremi. */
const HIGH_MIN_DELTA_M = 150;
/** Oltre queste tappe si chiede solo partenza e pernotti (limite punti). */
const MAX_STAGES_WITH_HIGH = 5;
/** Soste: il tempo totale è quello in movimento più il 20 %. */
const PAUSE_FACTOR = 1.2;

function buildPoints(stages: readonly Stage[]): PlanPointRequest[] {
  if (stages.length === 0) return [];
  const withHigh = stages.length <= MAX_STAGES_WITH_HIGH;
  const first = stages[0].start;
  const pts: PlanPointRequest[] = [
    { id: "start", label: "Partenza", kind: "start", day: 1, lat: first.lat, lng: first.lng, ele: first.ele },
  ];
  for (const s of stages) {
    const h = s.high;
    if (
      withHigh &&
      h?.ele != null &&
      (s.start.ele == null || h.ele - s.start.ele >= HIGH_MIN_DELTA_M) &&
      (s.end.ele == null || h.ele - s.end.ele >= HIGH_MIN_DELTA_M)
    ) {
      pts.push({ id: `high-${s.day}`, label: "Punto più alto", kind: "high", day: s.day, lat: h.lat, lng: h.lng, ele: h.ele });
    }
    pts.push({
      id: `end-${s.day}`,
      label: s.overnight ? `Pernotto${s.overnight_name ? ` · ${s.overnight_name}` : ""}` : "Arrivo",
      kind: s.overnight ? "camp" : "end",
      day: s.day,
      lat: s.end.lat,
      lng: s.end.lng,
      ele: s.end.ele,
    });
  }
  return pts;
}

function range(lo: number | null, hi: number | null, unit: string, digits = 0): string {
  if (lo == null && hi == null) return "—";
  const f = (v: number) => (digits ? v.toFixed(digits) : String(Math.round(v)));
  if (lo == null || hi == null || f(lo) === f(hi)) return `${f((hi ?? lo) as number)}${unit}`;
  return `${f(lo)}…${f(hi)}${unit}`;
}

function localTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

const HAZARD_TONE: Record<Hazard["level"], string> = {
  1: "border-[color:var(--hmr-warn)]/40 bg-[color:var(--hmr-warn)]/10 text-[color:var(--hmr-warn)]",
  2: "border-[color:var(--hmr-danger)]/40 bg-[color:var(--hmr-danger)]/10 text-[color:var(--hmr-danger)]",
  3: "border-[color:var(--hmr-danger)] bg-[color:var(--hmr-danger)]/20 text-[color:var(--hmr-danger)]",
};

function Hazards({ hazards }: { hazards: Hazard[] }) {
  if (hazards.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {hazards.map((h) => (
        <li key={h.id} className={`rounded-md border px-2 py-1 text-[11px] ${HAZARD_TONE[h.level]}`}>
          <b>{h.label}</b>
          {h.level === 3 ? " (estremo)" : ""} · {h.detail}
        </li>
      ))}
    </ul>
  );
}

function PointRow({ point, w }: { point: PlanPointForecast; w: WindowSummary | null }) {
  const ele = point.model_elevation_m ?? (point.ele != null ? Math.round(point.ele) : null);
  const agreement = w ? modelAgreement(w.spread_t_c) : null;
  return (
    <div className="border-t border-[color:var(--hmr-border)]/50 py-1.5 first:border-t-0">
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-[12px] font-semibold">
        <span>
          {point.label}
          {ele != null ? <span className="font-normal text-[color:var(--hmr-muted)]"> · {ele} m</span> : null}
        </span>
        {agreement && w ? (
          <span
            className={`text-[10.5px] font-medium ${agreement === "high" ? "text-[color:var(--hmr-safe)]" : agreement === "medium" ? "text-[color:var(--hmr-warn)]" : "text-[color:var(--hmr-danger)]"}`}
            title={`${w.models_n} modelli a confronto`}
          >
            {MODEL_AGREEMENT_LABELS[agreement]} (±{((w.spread_t_c ?? 0) / 2).toFixed(1)} °C)
          </span>
        ) : null}
      </p>
      {!w ? (
        <p className="text-[11.5px] text-[color:var(--hmr-faint)]">Nessuna previsione per questo giorno.</p>
      ) : (
        <>
          <p className="text-[12.5px] tabular-nums">
            <b>{range(w.temp_min_c, w.temp_max_c, " °C")}</b>
            {w.models_n > 1 && (w.t_low_c !== w.temp_min_c || w.t_high_c !== w.temp_max_c) ? (
              <span className="text-[color:var(--hmr-muted)]"> (tra i modelli {range(w.t_low_c, w.t_high_c, " °C")})</span>
            ) : null}
            {w.wind_chill_min_c != null && w.temp_min_c != null && w.wind_chill_min_c < w.temp_min_c - 1 ? (
              <span> · percepita min <b>{Math.round(w.wind_chill_min_c)} °C</b></span>
            ) : null}
          </p>
          <p className="text-[11.5px] tabular-nums text-[color:var(--hmr-muted)]">
            Umidità {range(w.humidity_min_pct, w.humidity_max_pct, " %")}
            {w.spread_rh_pct != null && w.spread_rh_pct >= 15 ? ` (modelli ±${Math.round(w.spread_rh_pct / 2)} %)` : ""}
            {w.dew_point_max_c != null ? ` · rugiada max ${Math.round(w.dew_point_max_c)} °C` : ""}
            {w.wet_bulb_max_c != null ? ` · bulbo umido max ${Math.round(w.wet_bulb_max_c)} °C` : ""}
          </p>
          <p className="text-[11.5px] tabular-nums text-[color:var(--hmr-muted)]">
            {w.precipitation_mm > 0
              ? `Precipitazioni ${w.precipitation_mm.toFixed(1)} mm${w.precip_prob_max_pct != null ? ` (prob. ${Math.round(w.precip_prob_max_pct)} %)` : ""}`
              : `Asciutto${w.precip_prob_max_pct != null && w.precip_prob_max_pct >= 30 ? ` (prob. pioggia ${Math.round(w.precip_prob_max_pct)} %)` : ""}`}
            {w.snowfall_cm > 0 ? ` · neve ${w.snowfall_cm.toFixed(0)} cm` : ""}
            {w.gust_max_kmh != null ? ` · raffiche ${Math.round(w.gust_max_kmh)} km/h` : ""}
            {w.freezing_level_min_m != null ? ` · zero termico ${range(w.freezing_level_min_m, w.freezing_level_max_m, " m")}` : ""}
            {w.uv_max != null && w.uv_max >= 6 ? ` · UV ${Math.round(w.uv_max)}` : ""}
            {w.cloud_avg_pct != null ? ` · nubi ${w.cloud_avg_pct} %` : ""}
          </p>
          <Hazards hazards={w.hazards} />
        </>
      )}
    </div>
  );
}

/**
 * Meteo di precisione per tappa: temperatura e umidità alla quota reale di partenza,
 * punto più alto e pernotti, con confronto tra modelli, stress termico, luce e acqua.
 */
export default function V2PrecisionForecast({ activity, date, startTime = null, profile, overnights }: Props) {
  const [data, setData] = useState<PlanForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stages = useMemo(() => buildStages(profile, overnights ?? [], activity), [profile, overnights, activity]);
  const points = useMemo(() => buildPoints(stages), [stages]);
  const requestKey = useMemo(
    () =>
      points.length
        ? JSON.stringify({
            start_date: date,
            days: stages.length,
            points: points.map((p) => ({ ...p, lat: Number(p.lat.toFixed(4)), lng: Number(p.lng.toFixed(4)), ele: p.ele == null ? null : Math.round(p.ele) })),
          })
        : null,
    [points, date, stages.length],
  );

  useEffect(() => {
    if (!requestKey) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Piccolo ritardo: mentre si modifica la traccia il profilo cambia più volte.
    const t = setTimeout(() => {
      fetchJson<{ forecast: PlanForecast }>("/api/v2/conditions/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestKey,
      })
        .then((r) => !cancelled && setData(r.forecast))
        .catch((e: unknown) => {
          if (cancelled) return;
          setData(null);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => !cancelled && setLoading(false));
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [requestKey]);

  if (points.length === 0) {
    return <p className="text-xs text-[color:var(--hmr-muted)]">Serve una traccia con il profilo altimetrico per il meteo di precisione.</p>;
  }
  if (loading && !data) return <p className="animate-pulse text-xs text-[color:var(--hmr-muted)]">Carico il meteo di precisione…</p>;
  if (error) return <p className="text-xs text-[color:var(--hmr-danger)]">Meteo di precisione non disponibile: {error}</p>;
  if (!data) return null;
  if (data.status === "out_of_range") return <p className="text-xs text-[color:var(--hmr-muted)]">{data.message}</p>;

  const byId = new Map(data.points.map((p) => [p.id, p]));
  const shifted = date != null && date !== data.start_date;
  const models = data.points[0]?.models ?? [];

  return (
    <div className="space-y-2 text-xs">
      {shifted || !date ? (
        <p className="text-[11px] text-[color:var(--hmr-faint)]">
          {date ? "La data della gita è passata" : "Gita senza data"}: previsioni a partire da oggi.
        </p>
      ) : null}
      {data.message ? <p className="text-[11px] text-[color:var(--hmr-warn)]">{data.message}</p> : null}

      {stages.map((s) => {
        const day = addDaysIso(data.start_date, s.day - 1);
        const light = data.daylight.find((d) => d.date === day);
        const stagePoints = data.points.filter((p) => p.day === s.day && (p.kind !== "start" || s.day === 1));
        const windows = stagePoints.map((p) => ({ p, w: summarizeWindow(hoursInDay(p.hourly, day, DAY_FROM_H, DAY_TO_H)) }));
        const camp = s.overnight ? byId.get(`end-${s.day}`) : undefined;
        const night = camp ? summarizeNight(camp.hourly, day, addDaysIso(day, 1), s.overnight_exposed) : null;

        const totalMin = Math.round(s.duration_min * PAUSE_FACTOR);
        const arrival = startTime ? addMinutesToTime(startTime, totalMin) : null;
        const sunsetLocal = light ? localTime(light.sunset) : null;
        const lateArrival = arrival && sunsetLocal && sunsetLocal !== "—" ? arrival.dayOffset > 0 || arrival.time > sunsetLocal : false;
        const latestStart =
          !startTime && light?.sunset ? new Date(new Date(light.sunset).getTime() - (totalMin + 60) * 60_000) : null;

        let tMax: number | null = null;
        let rhAtMax: number | null = null;
        for (const { w } of windows) {
          if (w?.temp_max_c != null && (tMax == null || w.temp_max_c > tMax)) {
            tMax = w.temp_max_c;
            rhAtMax = w.humidity_min_pct;
          }
        }
        const water = tMax != null ? waterLitersPerHour(tMax, rhAtMax, s.max_ele_m) * (s.duration_min / 60) : null;

        return (
          <section key={s.day} className="rounded-lg border border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-elev)]/40 px-2.5 py-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">
              {stageDayLabel(data.start_date, s.day)}
            </p>
            <p className="text-[11.5px] tabular-nums text-[color:var(--hmr-muted)]">
              {s.length_km.toFixed(1)} km · +{s.gain_m} m · {formatDuration(s.duration_min)} in movimento
              {light?.sunrise && light.sunset ? ` · luce ${localTime(light.sunrise)}–${sunsetLocal}` : ""}
            </p>
            {arrival ? (
              <p className={`text-[11.5px] ${lateArrival ? "font-semibold text-[color:var(--hmr-danger)]" : "text-[color:var(--hmr-muted)]"}`}>
                Arrivo stimato {arrival.time}
                {arrival.dayOffset > 0 ? " del giorno dopo" : ""} (soste incluse)
                {lateArrival ? " · dopo il tramonto: frontale e margine ridotto, valuta di partire prima" : ""}
              </p>
            ) : latestStart && !Number.isNaN(latestStart.getTime()) ? (
              <p className="text-[11.5px] text-[color:var(--hmr-muted)]">
                Per arrivare con un&apos;ora di luce di margine parti entro le{" "}
                <b>{latestStart.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</b>.
              </p>
            ) : null}

            <div className="mt-1">
              {windows.map(({ p, w }) => (
                <PointRow key={p.id} point={p} w={w} />
              ))}
            </div>

            {night ? (
              <div className="mt-1 rounded-md bg-[color:var(--hmr-bg)]/50 px-2 py-1.5">
                <p className="text-[12px] font-semibold">
                  Notte{s.overnight_name ? ` a ${s.overnight_name}` : ""}: minima <b>{Math.round(night.t_low_c as number)} °C</b>
                  {night.wind_chill_min_c != null && night.wind_chill_min_c < (night.t_low_c as number) - 1
                    ? ` · percepita ${Math.round(night.wind_chill_min_c)} °C`
                    : ""}
                </p>
                <p className="text-[11.5px] text-[color:var(--hmr-muted)]">
                  Umidità fino a {night.humidity_max_pct != null ? `${Math.round(night.humidity_max_pct)} %` : "—"}
                  {night.humidity_max_pct != null && night.humidity_max_pct >= 90 ? " (condensa: proteggi piumino e sacco)" : ""}
                  {night.gust_max_kmh != null ? ` · raffiche ${Math.round(night.gust_max_kmh)} km/h` : ""}
                  {" "}· sacco a pelo con comfort ≤ <b>{night.bag_comfort_c} °C</b>
                  {s.overnight_exposed ? " (notte esposta al vento)" : ""}
                </p>
                <Hazards hazards={night.hazards} />
              </div>
            ) : s.overnight ? (
              <p className="mt-1 text-[11.5px] text-[color:var(--hmr-faint)]">Notte fuori dall&apos;orizzonte delle previsioni.</p>
            ) : null}

            {water != null ? (
              <p className="mt-1 text-[11px] text-[color:var(--hmr-faint)]">
                Acqua stimata per la tappa: circa {Math.max(0.5, Math.round(water * 2) / 2).toLocaleString("it")} l a persona.
              </p>
            ) : null}
          </section>
        );
      })}

      <p className="text-[10px] text-[color:var(--hmr-faint)]">
        Open-Meteo, valori riportati alla quota del punto · ore {DAY_FROM_H}–{DAY_TO_H} per il giorno, 20–8 per la notte
        {models.length ? ` · modelli a confronto: ${models.map((m) => m.label).join(", ")}` : ""}. Percepita con le raffiche (wind
        chill JAG/TI), bulbo umido Stull. Stime da modello, non misure: in quota il vento reale su creste e colli può essere molto
        più forte.
      </p>
    </div>
  );
}
