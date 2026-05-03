"use client";

import { useCallback, useEffect, useState } from "react";
import type { RoadbookChunk } from "@/lib/roadbook-chunk";
import type { RoadbookAlert } from "@/lib/roadbook-alerts";
import type { CheckpointRow, PoiRow, ResupplyRow } from "@/lib/db";
import { CATEGORY_META } from "@/lib/categories";
import type { PoiCategory } from "@/lib/db";

const LS_PACE = "hmr_race_pace_kmh";

type BriefPayload = {
  at_km: number;
  remaining_km: number;
  next_checkpoint: (CheckpointRow & { ahead_km: number }) | null;
  next_resupply: (ResupplyRow & { ahead_km: number }) | null;
  next_by_category: Record<string, PoiRow & { ahead_km: number }>;
  chunks: RoadbookChunk[];
  alerts: RoadbookAlert[];
  overview_bullets_it: string[];
  overview_text: string;
  overview_source: "template" | "llm";
};

type Props = {
  trackId: string;
  lengthKm: number;
  atKm: number | null;
  raceStarted: boolean;
  onStartRace: () => void;
  onEndRace: () => void;
};

function pctBar(label: string, pct: number, color: string) {
  const w = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-[10px] text-[color:var(--hmr-muted)]">
        <span>{label}</span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[color:var(--hmr-elev)]">
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
      </div>
    </div>
  );
}

export default function RaceBriefPanel({
  trackId,
  lengthKm,
  atKm,
  raceStarted,
  onStartRace,
  onEndRace,
}: Props) {
  const [data, setData] = useState<BriefPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withLlm, setWithLlm] = useState(false);
  const [paceStr, setPaceStr] = useState("");

  useEffect(() => {
    try {
      const p = localStorage.getItem(LS_PACE);
      if (p) setPaceStr(p);
    } catch {
      /* ignore */
    }
  }, []);

  const savePace = () => {
    try {
      if (paceStr.trim()) localStorage.setItem(LS_PACE, paceStr.trim());
      else localStorage.removeItem(LS_PACE);
    } catch {
      /* ignore */
    }
  };

  const load = useCallback(() => {
    if (atKm == null) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({
      atKm: atKm.toFixed(2),
      aheadChunks: "6",
      chunkKm: "10",
      maxDetourM: "1500",
    });
    if (withLlm) q.set("withOverview", "1");
    fetch(`/api/track/${encodeURIComponent(trackId)}/race-brief?${q}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<BriefPayload>;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [trackId, atKm, withLlm]);

  useEffect(() => {
    load();
  }, [load]);

  const pace = Number(paceStr.replace(",", "."));
  const paceOk = Number.isFinite(pace) && pace > 0.5;
  const etaCp =
    data?.next_checkpoint && paceOk
      ? new Date(Date.now() + (data.next_checkpoint.ahead_km / pace) * 3600 * 1000)
      : null;

  const chunk0 = data?.chunks[0];

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {!raceStarted ? (
          <button type="button" className="hmr-btn hmr-btn-accent hmr-tap px-4 py-2 text-base font-semibold" onClick={onStartRace}>
            Inizia gara
          </button>
        ) : (
          <button type="button" className="hmr-btn hmr-tap text-xs" onClick={onEndRace}>
            Termina gara
          </button>
        )}
        <button type="button" className="hmr-btn hmr-tap text-xs" onClick={load} disabled={atKm == null}>
          {loading ? "Aggiorno…" : "Aggiorna"}
        </button>
        <label className="flex items-center gap-1 text-[10px] text-[color:var(--hmr-muted)]">
          <input type="checkbox" checked={withLlm} onChange={(e) => setWithLlm(e.target.checked)} />
          Overview AI (richiede chiave Anthropic)
        </label>
      </div>

      {atKm == null && (
        <p className="rounded-lg bg-[color:var(--hmr-elev)] p-3 text-xs text-[color:var(--hmr-warn)]">
          Attiva GPS o imposta il km nel tab «Qui e ora» per vedere il brief.
        </p>
      )}

      {error && <p className="text-xs text-[color:var(--hmr-danger)]">{error}</p>}

      {data && atKm != null && (
        <>
          <div className="hmr-panel grid gap-1 p-4">
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--hmr-muted)]">Progresso</div>
            <div className="text-2xl font-bold">
              {data.remaining_km.toFixed(1)} km mancanti
              <span className="ml-2 text-sm font-normal text-[color:var(--hmr-muted)]">
                ({((atKm / lengthKm) * 100).toFixed(1)}% fatto)
              </span>
            </div>
          </div>

          {data.alerts.length > 0 && (
            <div className="flex flex-col gap-2">
              {data.alerts.slice(0, 4).map((a) => (
                <div
                  key={a.code}
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    a.level === "warn"
                      ? "border-amber-500/50 bg-amber-500/10"
                      : "border-sky-500/40 bg-sky-500/10"
                  }`}
                >
                  {a.message_it}
                </div>
              ))}
            </div>
          )}

          <div className="hmr-panel space-y-2 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">
              Prossimo checkpoint / resupply
            </div>
            {data.next_checkpoint && (
              <div className="text-base font-medium">
                {data.next_checkpoint.name}: +{data.next_checkpoint.ahead_km.toFixed(1)} km
              </div>
            )}
            {data.next_resupply && (
              <div className="text-sm text-[color:var(--hmr-muted)]">
                Resupply {data.next_resupply.name}: +{data.next_resupply.ahead_km.toFixed(1)} km
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2 border-t border-[color:var(--hmr-border)]/40 pt-2">
              <label className="flex flex-col text-[10px] text-[color:var(--hmr-muted)]">
                Ritmo medio (km/h) — stima ETA
                <input
                  value={paceStr}
                  onChange={(e) => setPaceStr(e.target.value)}
                  onBlur={savePace}
                  placeholder="es. 12"
                  className="mt-0.5 w-24 rounded border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-1 text-sm"
                />
              </label>
              {etaCp && (
                <span className="text-xs text-[color:var(--hmr-muted)]">
                  Stima arrivo CP: {etaCp.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
          </div>

          <div className="hmr-panel space-y-2 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">
              Servizi · prossimi 60 km
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                ["water", "restaurant", "lodging", "shop", "hut", "pharmacy"] as PoiCategory[]
              ).map((cat) => {
                const n = data.next_by_category[cat] as (PoiRow & { ahead_km: number }) | undefined;
                const meta = CATEGORY_META[cat];
                return (
                  <div key={cat} className="rounded-md bg-[color:var(--hmr-elev)] p-2 text-xs">
                    <span className="text-[color:var(--hmr-muted)]">
                      {meta.emoji} {meta.label}
                    </span>
                    {n ? (
                      <div className="font-medium">+{n.ahead_km.toFixed(1)} km</div>
                    ) : (
                      <div className="text-[color:var(--hmr-faint)]">—</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {chunk0 && (
            <div className="hmr-panel space-y-3 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">
                Blocco corrente · km {chunk0.km_start.toFixed(0)}–{chunk0.km_end.toFixed(0)}
              </div>
              <div className="grid gap-2">
                {pctBar("Asfalto", chunk0.surface_pct.asphalt, "#94a3b8")}
                {pctBar("Sterrato", chunk0.surface_pct.gravel, "#ca8a04")}
                {pctBar("Single", chunk0.surface_pct.single, "#16a34a")}
              </div>
              {chunk0.steep_unpaved && (
                <p className="text-xs text-[color:var(--hmr-warn)]">
                  Pendenza stimata su sterrato/sentiero (≥15%).
                  {chunk0.steep_unpaved_max_grade_pct != null
                    ? ` Max ~${chunk0.steep_unpaved_max_grade_pct}%.`
                    : ""}
                </p>
              )}
              {chunk0.hike_a_bike_hint && (
                <p className="text-xs text-[color:var(--hmr-warn)]">Possibile hike-a-bike.</p>
              )}
            </div>
          )}

          <div className="hmr-panel space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">
                Dopo · overview
              </span>
              <span className="text-[10px] text-[color:var(--hmr-faint)]">
                {data.overview_source === "llm" ? "Sintesi AI" : "Testo automatico"}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-[color:var(--hmr-text)]">{data.overview_text}</p>
            <button
              type="button"
              className="hmr-btn hmr-tap text-xs"
              onClick={() => {
                void navigator.clipboard?.writeText(data.overview_text).catch(() => {});
              }}
            >
              Copia overview
            </button>
            {data.overview_bullets_it.length > 1 && (
              <ul className="list-inside list-disc text-xs text-[color:var(--hmr-muted)]">
                {data.overview_bullets_it.slice(1).map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
