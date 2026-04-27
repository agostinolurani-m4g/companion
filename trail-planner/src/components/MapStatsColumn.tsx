"use client";

import type { ReactNode } from "react";
import { LegDaySummaryBar } from "@/components/LegDaySummaryBar";
import { OsmWaterNearby } from "@/components/OsmWaterNearby";
import { PublishOutingBar } from "@/components/PublishOutingBar";
import { SafetyChecklistBar } from "@/components/SafetyChecklistBar";
import type { LegDayStat } from "@/lib/leg-day-stats";
import type { TrailServicePoi } from "@/lib/overpass";

type LastImport = {
  track_id: string;
  distance_km: number;
  points: number;
};

type Props = {
  lastImport: LastImport | null;
  stopsCount: number;
  weatherAlerts: string[];
  onRefreshWeather: () => void;
  onOpenWeatherTab: () => void;
  children: ReactNode;
  onWaterForMap?: (pois: { lat: number; lng: number }[]) => void;
  onServicesForMap?: (pois: TrailServicePoi[]) => void;
  className?: string;
  /** Routing OSRM in corso (manuale o automatico). */
  routeComputing?: boolean;
  /** Statistiche per giornata (leg). */
  legDayStats?: LegDayStat[] | null;
  activeItineraryId?: string | null;
  hasActiveUser?: boolean;
  hasLineOnMap?: boolean;
  onOutingPublished?: () => void;
};

export function MapStatsColumn({
  lastImport,
  stopsCount,
  weatherAlerts,
  onRefreshWeather,
  onOpenWeatherTab,
  children,
  onWaterForMap,
  onServicesForMap,
  className = "",
  routeComputing = false,
  legDayStats = null,
  activeItineraryId = null,
  hasActiveUser = false,
  hasLineOnMap = false,
  onOutingPublished,
}: Props) {
  return (
    <div
      className={`flex max-h-[min(52vh,480px)] shrink-0 flex-col gap-2 overflow-y-auto rounded-xl border border-brand-border/70 bg-brand-surface/50 p-2 text-[11px] text-brand-text ${className}`}
    >
      {routeComputing ? (
        <p className="rounded border border-sky-800/50 bg-sky-950/40 px-2 py-1.5 text-[10px] text-sky-100/95">
          Calcolo percorso sulla strada (OSRM)…
        </p>
      ) : null}

      {lastImport && (
        <div className="leading-snug text-zinc-400">
          Ultimo import GPX:{" "}
          <code className="rounded bg-zinc-900 px-1 text-emerald-400/90">{lastImport.track_id}</code> ·{" "}
          {lastImport.distance_km.toFixed(1)} km · {lastImport.points} punti — in chat{" "}
          <code className="text-zinc-300">get_track_summary</code> con questo ID.
        </div>
      )}

      <div className="rounded border border-zinc-800/60 bg-zinc-950/35 px-2 py-1.5 text-[10px] text-zinc-500">
        <span className="font-medium text-zinc-400">Export</span>
        <p className="mt-0.5 leading-snug">
          <strong className="text-zinc-300">GPX ↓</strong>: file per dispositivo GPS / app esterne (serve una traccia
          salvata sulla mappa).
        </p>
        <p className="mt-0.5 leading-snug">
          <strong className="text-zinc-300">ICS</strong>: promemoria calendario —{" "}
          <span className="text-amber-200/80">richiede date inizio/fine</span> sull’itinerario.
        </p>
        {activeItineraryId ? (
          <p className="mt-1 leading-snug">
            <strong className="text-zinc-300">Riepilogo stampabile</strong> —{" "}
            <a
              className="text-sky-300 underline hover:text-sky-200"
              href={`/api/itineraries/${activeItineraryId}/briefing`}
              target="_blank"
              rel="noreferrer"
            >
              Apri HTML (poi Stampa → PDF)
            </a>
          </p>
        ) : null}
      </div>

      <SafetyChecklistBar onOpenWeatherTab={onOpenWeatherTab} />

      {legDayStats && legDayStats.length > 0 ? <LegDaySummaryBar legs={legDayStats} /> : null}

      <PublishOutingBar
        itineraryId={activeItineraryId}
        hasActiveUser={hasActiveUser}
        hasLineOnMap={hasLineOnMap}
        onPublished={onOutingPublished}
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/60 pb-2 text-zinc-500">
        <span>
          Tappe: <strong className="text-zinc-300">{stopsCount}</strong>
        </span>
        <span className="text-zinc-600">·</span>
        <span>
          Meteo:{" "}
          {weatherAlerts.length === 0 ? (
            <span className="text-zinc-500">nessuna allerta sopra soglia</span>
          ) : (
            <span className="text-amber-200/90">{weatherAlerts.length} avviso/i</span>
          )}
        </span>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700"
          onClick={onRefreshWeather}
        >
          Aggiorna
        </button>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700"
          onClick={onOpenWeatherTab}
        >
          Tab meteo
        </button>
      </div>

      <OsmWaterNearby onWaterForMap={onWaterForMap} onServicesForMap={onServicesForMap} />

      {children}
    </div>
  );
}
