"use client";

import { useEffect, useMemo, useState } from "react";
import type { ConditionsPayload, DailyWeather, PointForecast, WeatherAlert } from "@/lib/conditions";
import type { AvalanchePointPayload } from "@/lib/avalanche-bulletin";
import { bulletinDangerLabel, dangerLabel, elevationBandLabel } from "@/lib/avalanche-caaml";
import { fetchJson } from "@/lib/fetch-json";
import { isUserRouteActivity, SPORTS, type ConditionWidgetId } from "@/lib/sports";

type Props = {
  lat: number | null;
  lng: number | null;
  compact?: boolean;
  /** Attività: decide quali widget mostrare (`SPORTS[*].conditionWidgets`). */
  activity?: string | null;
  /** Profilo del percorso `[lng, lat, quota|null, ...]`: partenza e punto più alto. */
  profile?: readonly (readonly (number | null)[])[] | null;
  /** Esposizioni del percorso (es. ["N","NW"]) per il confronto col bollettino. */
  orientations?: string[] | null;
};

const DEFAULT_WIDGETS: ConditionWidgetId[] = ["weather_hourly", "risk_semaphore", "daylight"];

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function fmtDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric" });
}

function rangeLabel(lo: number | null, hi: number | null, unit: string): string {
  if (lo == null && hi == null) return "—";
  if (lo == null || hi == null || Math.round(lo) === Math.round(hi)) return `${Math.round((hi ?? lo) as number)}${unit}`;
  return `${Math.round(lo)}–${Math.round(hi)}${unit}`;
}

function summitFrom(profile: Props["profile"]): { start: number | null; summit: { lat: number; lng: number; ele: number } | null } {
  if (!profile || profile.length < 2) return { start: null, summit: null };
  const first = profile[0];
  let summit: { lat: number; lng: number; ele: number } | null = null;
  for (const c of profile) {
    const e = c[2];
    if (typeof e !== "number" || !Number.isFinite(e) || c[0] == null || c[1] == null) continue;
    if (!summit || e > summit.ele) summit = { lng: c[0], lat: c[1], ele: e };
  }
  return { start: typeof first[2] === "number" ? first[2] : null, summit };
}

const ALERT_TONE: Record<WeatherAlert["color"], string> = {
  yellow: "border-[color:var(--hmr-warn)]/40 bg-[color:var(--hmr-warn)]/10 text-[color:var(--hmr-warn)]",
  orange: "border-[color:var(--hmr-warn)]/60 bg-[color:var(--hmr-warn)]/15 text-[color:var(--hmr-warn)]",
  red: "border-[color:var(--hmr-danger)]/50 bg-[color:var(--hmr-danger)]/10 text-[color:var(--hmr-danger)]",
};

function DaysTable({ start, summit, winter }: { start: PointForecast; summit: PointForecast | null; winter: boolean }) {
  const rows: { label: string; days: DailyWeather[] }[] = [
    { label: `Partenza${start.model_elevation_m != null ? ` · ${start.model_elevation_m} m` : ""}`, days: start.daily },
  ];
  if (summit) rows.push({ label: `Punto più alto · ${summit.model_elevation_m ?? summit.requested_elevation_m} m`, days: summit.daily });
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">{r.label}</p>
          <div className="grid grid-cols-3 gap-1">
            {r.days.slice(0, 3).map((d) => (
              <div key={d.date} className="rounded-lg border border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-elev)]/50 px-2 py-1">
                <p className="text-[10px] text-[color:var(--hmr-muted)]">{fmtDay(d.date)}</p>
                <p className="font-medium">{rangeLabel(d.temp_min_c, d.temp_max_c, "°")}</p>
                <p className="text-[10px] text-[color:var(--hmr-muted)]">
                  {d.precipitation_mm > 0 ? `${d.precipitation_mm.toFixed(1)} mm` : "secco"}
                  {d.gust_max_kmh != null ? ` · raffiche ${Math.round(d.gust_max_kmh)} km/h` : ""}
                </p>
                {winter ? (
                  <p className="text-[10px] text-[color:var(--hmr-muted)]">
                    0 °C {rangeLabel(d.freezing_level_min_m, d.freezing_level_max_m, " m")}
                    {d.snowfall_cm != null ? ` · neve fresca ${d.snowfall_cm.toFixed(0)} cm` : ""}
                    {d.snow_depth_max_cm != null ? ` · al suolo ${d.snow_depth_max_cm} cm` : ""}
                    {d.wind_700hpa_max_kmh != null ? ` · vento 3000 m ${Math.round(d.wind_700hpa_max_kmh)} km/h` : ""}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
      {winter ? (
        <p className="text-[10px] text-[color:var(--hmr-faint)]">
          Neve fresca e altezza neve sono stime del modello Open-Meteo, non misure: verifica con stazioni e bollettini locali.
        </p>
      ) : null}
    </div>
  );
}

function AvalancheDetail({ data }: { data: AvalanchePointPayload | null }) {
  if (!data) return <p className="text-[color:var(--hmr-muted)]">Bollettino valanghe: caricamento…</p>;
  const b = data.bulletin;
  return (
    <div className="space-y-1.5 rounded-lg border border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-elev)]/40 px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">Bollettino valanghe</p>
      {!b ? (
        <>
          <p className="font-medium">{data.message ?? "Nessun bollettino disponibile per questa zona."}</p>
          {data.next ? (
            <p className="text-[11px] text-[color:var(--hmr-muted)]">
              Già pubblicato il prossimo bollettino: grado {dangerLabel(data.next.maxDanger)}, valido dal {fmtDateTime(data.next.validFrom)}.
            </p>
          ) : null}
          <p className="text-[10px] text-[color:var(--hmr-faint)]">Assenza di bollettino non significa assenza di pericolo.</p>
        </>
      ) : (
        <>
          <p className="font-semibold">
            {b.maxDanger != null ? `Grado ${dangerLabel(b.maxDanger)}` : bulletinDangerLabel(b)} · {b.regionName}
          </p>
          {b.ratings.length > 1 ? (
            <p className="text-[11px] text-[color:var(--hmr-muted)]">
              {b.ratings
                .filter((r) => r.level != null)
                .map((r) => `${dangerLabel(r.level)} ${elevationBandLabel(r.elevation)}`)
                .join(" · ")}
            </p>
          ) : null}
          {b.problems.length ? (
            <ul className="space-y-0.5 text-[11px]">
              {b.problems.map((p, i) => (
                <li key={`${p.type}-${i}`}>
                  <b>{p.label}</b> · {elevationBandLabel(p.elevation)}
                  {p.aspects.length ? ` · esposizioni ${p.aspects.length === 8 ? "tutte" : p.aspects.join(", ")}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {b.tendency?.label ? <p className="text-[11px] text-[color:var(--hmr-muted)]">Tendenza: {b.tendency.label}</p> : null}
          {b.highlights ? <p className="text-[11px]">{b.highlights}</p> : null}
          <p
            className={`text-[11px] ${data.aspectCheck.status === "match" ? "font-medium text-[color:var(--hmr-danger)]" : "text-[color:var(--hmr-muted)]"}`}
          >
            {data.aspectCheck.text}
          </p>
          <p className="text-[10px] text-[color:var(--hmr-faint)]">
            {b.provider.website ? (
              <a href={b.provider.website} target="_blank" rel="noreferrer" className="underline">
                {b.provider.name}
              </a>
            ) : (
              b.provider.name
            )}
            {" "}· emesso {fmtDateTime(b.publicationTime)} · valido fino a {fmtDateTime(b.validUntil)}
            {b.lang && b.lang !== "it" ? ` · testo in lingua originale (${b.lang})` : ""}
          </p>
        </>
      )}
    </div>
  );
}

export default function V2ConditionsPanel({ lat, lng, compact = false, activity = null, profile = null, orientations = null }: Props) {
  const [data, setData] = useState<ConditionsPayload | null>(null);
  const [aval, setAval] = useState<AvalanchePointPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const widgets = activity && isUserRouteActivity(activity) ? SPORTS[activity].conditionWidgets : DEFAULT_WIDGETS;
  const wantAvalanche = widgets.includes("avalanche_detail");
  const { start: startEle, summit } = useMemo(() => summitFrom(profile), [profile]);
  const minEle = useMemo(() => {
    let m: number | null = null;
    for (const c of profile ?? []) if (typeof c[2] === "number" && (m == null || c[2] < m)) m = c[2];
    return m;
  }, [profile]);
  const orientKey = (orientations ?? []).join(",");

  const query = useMemo(() => {
    if (lat == null || lng == null) return null;
    const q = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    if (activity) q.set("activity", activity);
    if (startEle != null) q.set("start_ele", String(Math.round(startEle)));
    if (summit) {
      q.set("summit_lat", summit.lat.toFixed(5));
      q.set("summit_lng", summit.lng.toFixed(5));
      q.set("summit_ele", String(Math.round(summit.ele)));
    }
    return q.toString();
  }, [lat, lng, activity, startEle, summit]);

  useEffect(() => {
    if (!query) {
      setData(null);
      return;
    }
    setLoading(true);
    void fetchJson<{ conditions: ConditionsPayload }>(`/api/v2/conditions?${query}`)
      .then((r) => setData(r.conditions))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    if (!wantAvalanche || lat == null || lng == null) {
      setAval(null);
      return;
    }
    const q = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    if (orientKey) q.set("orientations", orientKey);
    if (minEle != null) q.set("min_ele", String(Math.round(minEle)));
    if (summit) q.set("max_ele", String(Math.round(summit.ele)));
    setAval(null);
    void fetchJson<{ point: AvalanchePointPayload }>(`/api/v2/ski/avalanche?${q}`)
      .then((r) => setAval(r.point))
      .catch(() =>
        setAval({
          status: "no_bulletin",
          message: "Bollettino valanghe non raggiungibile.",
          region: null,
          bulletin: null,
          next: null,
          aspectCheck: { status: "no_bulletin", matchedAspects: [], criticalAspects: [], matchedProblems: [], text: "" },
          fetchedAt: Date.now(),
        }),
      );
  }, [wantAvalanche, lat, lng, orientKey, minEle, summit]);

  if (lat == null || lng == null) {
    return (
      <p className="text-xs text-[color:var(--hmr-muted)]">Disegna un percorso per il briefing meteo.</p>
    );
  }

  if (loading && !data) {
    return <p className="text-xs text-[color:var(--hmr-muted)] animate-pulse">Caricamento condizioni…</p>;
  }

  if (!data) {
    return <p className="text-xs text-[color:var(--hmr-muted)]">Condizioni non disponibili.</p>;
  }

  const next = data.hourly.slice(0, compact ? 6 : 12);
  const risk = data.thunderstorm_risk;
  const riskLabel = risk >= 70 ? "Alto" : risk >= 40 ? "Medio" : "Basso";
  const riskColor =
    risk >= 70 ? "text-[color:var(--hmr-danger)]" : risk >= 40 ? "text-[color:var(--hmr-warn)]" : "text-[color:var(--hmr-safe)]";
  const alerts = data.alerts ?? [];
  const alertsInfo = data.alerts_info;

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {widgets.includes("risk_semaphore") || !activity ? (
          <>
            <span className="text-[color:var(--hmr-muted)]">Temporali:</span>
            <span className={`font-medium ${riskColor}`}>{riskLabel} ({risk}%)</span>
          </>
        ) : null}
        {widgets.includes("daylight") ? (
          <span className="text-[color:var(--hmr-muted)]">· Luce: {data.daylight.daylight_hours}h</span>
        ) : null}
      </div>

      {alerts.length > 0 ? (
        <ul className="space-y-1">
          {alerts.map((a) => (
            <li key={`${a.title}-${a.onset}`} className={`rounded-lg border px-2 py-1 text-[11px] ${ALERT_TONE[a.color]}`}>
              <b>{a.title}</b> · {a.area} · {fmtDateTime(a.onset)} → {fmtDateTime(a.expires)}
              {a.description && !compact ? <span className="block opacity-90">{a.description}</span> : null}
            </li>
          ))}
        </ul>
      ) : alertsInfo?.status === "ok" ? (
        <p className="text-[10px] text-[color:var(--hmr-muted)]">Nessuna allerta MeteoAlarm attiva per {alertsInfo.area}.</p>
      ) : alertsInfo?.message ? (
        <p className="text-[10px] text-[color:var(--hmr-faint)]">{alertsInfo.message}</p>
      ) : null}
      {alertsInfo?.disclaimer && !compact ? (
        <p className="text-[10px] text-[color:var(--hmr-faint)]">{alertsInfo.disclaimer}</p>
      ) : null}

      <div className="flex gap-1 overflow-x-auto pb-1">
        {next.map((h) => (
          <div
            key={h.time}
            className="min-w-[4.5rem] shrink-0 rounded-lg border border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-elev)]/50 px-2 py-1"
          >
            <p className="text-[10px] text-[color:var(--hmr-muted)]">{h.time.slice(11, 16)}</p>
            <p className="font-medium">{Math.round(h.temperature_c)}°</p>
            {h.apparent_c != null && Math.abs(h.apparent_c - h.temperature_c) >= 2 ? (
              <p className="text-[10px] text-[color:var(--hmr-muted)]">perc. {Math.round(h.apparent_c)}°</p>
            ) : null}
            <p className="text-[10px] text-[color:var(--hmr-muted)]">
              {h.precipitation_mm > 0 ? `${h.precipitation_mm.toFixed(1)} mm` : "—"}
              {h.humidity_pct != null ? ` · ${Math.round(h.humidity_pct)} %` : ""}
            </p>
          </div>
        ))}
      </div>

      {!compact && data.start ? <DaysTable start={data.start} summit={data.summit} winter={data.winter} /> : null}

      {wantAvalanche ? <AvalancheDetail data={aval} /> : null}

      <p className="text-[10px] text-[color:var(--hmr-faint)]">
        Meteo Open-Meteo · {data.forecast_days ?? 2} giorni · aggiornato {fmtDateTime(new Date(data.fetched_at).toISOString())}
      </p>
    </div>
  );
}
