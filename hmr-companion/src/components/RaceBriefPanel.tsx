"use client";

import { useCallback, useEffect, useState } from "react";
import type { RoadbookChunk } from "@/lib/roadbook-chunk";
import type { RoadbookAlert } from "@/lib/roadbook-alerts";
import type { CheckpointRow, PoiRow, RacePlanItemRow, ResupplyRow } from "@/lib/db";
import { CATEGORY_META } from "@/lib/categories";
import type { PoiCategory } from "@/lib/db";
import { labelRacePlanItemKind } from "@/lib/race-plan-types";

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
  racePlanName?: string | null;
  racePlanUpcomingItems?: RacePlanItemRow[];
  /** Tab mappa + zoom sul km (es. voce piano). */
  onJumpToKm?: (km: number) => void;
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
  racePlanName = null,
  racePlanUpcomingItems = [],
  onJumpToKm,
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

  const [clockReady, setClockReady] = useState(false);
  useEffect(() => {
    setClockReady(true);
  }, []);

  const pace = Number(paceStr.replace(",", "."));
  const paceOk = Number.isFinite(pace) && pace > 0.5;
  const etaCp =
    clockReady && data?.next_checkpoint && paceOk
      ? new Date(Date.now() + (data.next_checkpoint.ahead_km / pace) * 3600 * 1000)
      : null;

  const chunk0 = data?.chunks[0];
  const pctDone = atKm != null && lengthKm > 0 ? Math.min(100, Math.max(0, (atKm / lengthKm) * 100)) : 0;

  return (
    <div className="flex flex-col gap-2 p-2 text-sm">
      <div className="flex flex-wrap items-stretch gap-1.5">
        {!raceStarted ? (
          <button
            type="button"
            className="hmr-btn hmr-btn-accent hmr-tap flex-1 px-2 py-2 text-xs font-semibold sm:flex-none sm:px-4 sm:text-sm"
            onClick={onStartRace}
          >
            Inizia gara
          </button>
        ) : (
          <button type="button" className="hmr-btn hmr-tap flex-1 px-2 py-2 text-xs sm:flex-none" onClick={onEndRace}>
            Termina gara
          </button>
        )}
        <button type="button" className="hmr-btn hmr-tap flex-1 px-2 py-2 text-xs sm:flex-none" onClick={load} disabled={atKm == null}>
          {loading ? "Aggiorno…" : "Aggiorna"}
        </button>
      </div>

      <details className="rounded-md border border-[color:var(--hmr-border)]/50 bg-black/10 px-2 py-1 text-[10px] text-[color:var(--hmr-muted)]">
        <summary className="cursor-pointer select-none font-medium text-[color:var(--hmr-text)]">Opzioni</summary>
        <label className="mt-2 flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={withLlm} onChange={(e) => setWithLlm(e.target.checked)} />
          Overview AI (richiede chiave Anthropic)
        </label>
      </details>

      {atKm == null && (
        <p className="rounded-lg bg-[color:var(--hmr-elev)] p-2 text-xs text-[color:var(--hmr-warn)]">
          Attiva GPS o imposta il km nel tab «Qui e ora» per vedere il brief.
        </p>
      )}

      {error && <p className="text-xs text-[color:var(--hmr-danger)]">{error}</p>}

      {racePlanName != null && racePlanName !== "" && (
        <div className="hmr-panel space-y-1.5 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">
            Piano · {racePlanName}
          </div>
          {atKm == null ? (
            <p className="text-xs text-[color:var(--hmr-muted)]">Imposta posizione per le prossime voci.</p>
          ) : racePlanUpcomingItems.length === 0 ? (
            <p className="text-xs text-[color:var(--hmr-faint)]">Nessuna voce fino al traguardo.</p>
          ) : (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1 pt-0.5" style={{ WebkitOverflowScrolling: "touch" }}>
              {racePlanUpcomingItems.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => onJumpToKm?.(it.km_start)}
                  className="hmr-tap shrink-0 rounded-md border border-[color:var(--hmr-border)]/70 bg-[color:var(--hmr-elev)] px-2 py-1.5 text-left text-[11px] shadow-sm"
                >
                  <div className="font-semibold tabular-nums text-[color:var(--hmr-accent)]">km {it.km_start.toFixed(1)}</div>
                  <div className="max-w-[9rem] truncate text-[color:var(--hmr-muted)]">{labelRacePlanItemKind(it.kind)}</div>
                  <div className="max-w-[9rem] truncate font-medium text-[color:var(--hmr-text)]">{it.title || "—"}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {data && atKm != null && (
        <>
          <div className="hmr-panel space-y-1.5 p-3">
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--hmr-muted)]">Progresso</div>
            <div className="text-xl font-bold tabular-nums sm:text-2xl">
              {data.remaining_km.toFixed(1)} km
              <span className="ml-1.5 text-xs font-normal text-[color:var(--hmr-muted)] sm:text-sm">mancanti</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[color:var(--hmr-muted)]">
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[color:var(--hmr-elev)]">
                <div className="h-full rounded-full bg-[color:var(--hmr-accent)]" style={{ width: `${pctDone}%` }} />
              </div>
              <span className="shrink-0 tabular-nums">{pctDone.toFixed(1)}%</span>
            </div>
          </div>

          {data.alerts.length > 0 && (
            <div className="flex max-h-24 flex-col gap-1 overflow-y-auto">
              {data.alerts.slice(0, 4).map((a) => (
                <div
                  key={a.code}
                  className={`rounded-md border px-2 py-1.5 text-[11px] leading-snug ${
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

          <div className="hmr-panel space-y-2 p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">Prossimi obiettivi</div>
            {data.next_checkpoint && (
              <div className="text-sm font-medium leading-tight">
                CP {data.next_checkpoint.name}
                <span className="ml-1 tabular-nums text-[color:var(--hmr-accent)]">+{data.next_checkpoint.ahead_km.toFixed(1)} km</span>
              </div>
            )}
            {data.next_resupply && (
              <div className="text-xs leading-tight text-[color:var(--hmr-muted)]">
                Resupply {data.next_resupply.name}
                <span className="ml-1 tabular-nums text-[color:var(--hmr-text)]">+{data.next_resupply.ahead_km.toFixed(1)} km</span>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2 border-t border-[color:var(--hmr-border)]/40 pt-2">
              <label className="flex flex-col text-[10px] text-[color:var(--hmr-muted)]">
                Ritmo km/h
                <input
                  value={paceStr}
                  onChange={(e) => setPaceStr(e.target.value)}
                  onBlur={savePace}
                  placeholder="es. 12"
                  className="mt-0.5 w-20 rounded border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-1.5 py-1 text-xs"
                />
              </label>
              {etaCp && (
                <span className="text-[10px] text-[color:var(--hmr-muted)]">
                  ETA CP ~{etaCp.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
          </div>

          <div className="hmr-panel p-2">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">
              Servizi · 60 km
            </div>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
              {(["water", "restaurant", "lodging", "shop", "hut", "pharmacy"] as PoiCategory[]).map((cat) => {
                const n = data.next_by_category[cat] as (PoiRow & { ahead_km: number }) | undefined;
                const meta = CATEGORY_META[cat];
                return (
                  <div
                    key={cat}
                    className="hmr-tap shrink-0 rounded-md bg-[color:var(--hmr-elev)] px-2.5 py-1.5 text-center text-[11px]"
                  >
                    <div className="text-[color:var(--hmr-muted)]">{meta.label}</div>
                    {n ? (
                      <div className="font-semibold tabular-nums">+{n.ahead_km.toFixed(1)}</div>
                    ) : (
                      <div className="text-[color:var(--hmr-faint)]">—</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {chunk0 && (
            <details className="hmr-panel group p-2">
              <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)] [&::-webkit-details-marker]:hidden">
                Blocco km {chunk0.km_start.toFixed(0)}–{chunk0.km_end.toFixed(0)} · superficie
              </summary>
              <div className="mt-2 grid gap-2">
                {pctBar("Asfalto", chunk0.surface_pct.asphalt, "#94a3b8")}
                {pctBar("Sterrato", chunk0.surface_pct.gravel, "#ca8a04")}
                {pctBar("Single", chunk0.surface_pct.single, "#16a34a")}
              </div>
              {chunk0.steep_unpaved && (
                <p className="mt-2 text-xs text-[color:var(--hmr-warn)]">
                  Pendenza stimata su sterrato/sentiero (≥15%).
                  {chunk0.steep_unpaved_max_grade_pct != null ? ` Max ~${chunk0.steep_unpaved_max_grade_pct}%.` : ""}
                </p>
              )}
              {chunk0.hike_a_bike_hint && (
                <p className="mt-1 text-xs text-[color:var(--hmr-warn)]">Possibile hike-a-bike.</p>
              )}
            </details>
          )}

          <div className="hmr-panel space-y-2 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">Overview</span>
              <span className="text-[10px] text-[color:var(--hmr-faint)]">
                {data.overview_source === "llm" ? "AI" : "Auto"}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-[color:var(--hmr-text)]">{data.overview_text}</p>
            <button
              type="button"
              className="hmr-btn hmr-tap text-[10px]"
              onClick={() => {
                void navigator.clipboard?.writeText(data.overview_text).catch(() => {});
              }}
            >
              Copia
            </button>
            {data.overview_bullets_it.length > 1 && (
              <ul className="list-inside list-disc text-[11px] text-[color:var(--hmr-muted)]">
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
