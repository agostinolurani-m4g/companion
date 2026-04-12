"use client";

import type { ReactNode } from "react";
import { OsmWaterNearby } from "@/components/OsmWaterNearby";

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
  className?: string;
};

export function MapStatsColumn({
  lastImport,
  stopsCount,
  weatherAlerts,
  onRefreshWeather,
  onOpenWeatherTab,
  children,
  className = "",
}: Props) {
  return (
    <div
      className={`flex max-h-[min(52vh,480px)] shrink-0 flex-col gap-2 overflow-y-auto rounded-lg border border-zinc-800/80 bg-zinc-900/25 p-2 text-[11px] ${className}`}
    >
      {lastImport && (
        <div className="leading-snug text-zinc-400">
          Ultimo import GPX:{" "}
          <code className="rounded bg-zinc-900 px-1 text-emerald-400/90">{lastImport.track_id}</code> ·{" "}
          {lastImport.distance_km.toFixed(1)} km · {lastImport.points} punti — in chat{" "}
          <code className="text-zinc-300">get_track_summary</code> con questo ID.
        </div>
      )}

      <details className="rounded border border-zinc-800/60 bg-zinc-950/40 px-2 py-1.5 text-[10px] leading-snug text-zinc-500">
        <summary className="cursor-pointer select-none text-zinc-400">Come funziona «Traccia su strada»?</summary>
        <p className="mt-1.5 border-t border-zinc-800/80 pt-1.5">
          Il routing segue <strong className="text-zinc-400">OpenStreetMap</strong> (non è un tracciato satellitare).
          Per <strong className="text-zinc-400">escursionismo / trail</strong>, se configuri{" "}
          <code className="text-zinc-400">OPENROUTESERVICE_API_KEY</code> in{" "}
          <code className="text-zinc-400">.env.local</code>, usiamo <strong className="text-zinc-400">OpenRoute Service</strong>{" "}
          profilo <code className="text-zinc-400">foot-hiking</code> (privilegia sentieri rispetto all’asfalto). Senza
          chiave resta il server demo <strong className="text-zinc-400">OSRM</strong>, spesso più “stradale”.{" "}
          <code className="text-zinc-400">cycling</code> = bici; <code className="text-zinc-400">walking</code> = corsa
          su strada. Con almeno <strong className="text-zinc-400">due tappe</strong> il percorso si aggiorna da solo
          (dopo ~0,5 s) salvo <strong className="text-zinc-400">GPX</strong> collegato. Dove OSM non ha sentieri tra due
          punti, importa un <strong className="text-zinc-400">GPX</strong> o aggiungi tappe lungo il percorso reale.
        </p>
      </details>

      <p className="text-[10px] leading-snug text-zinc-500">
        Clic vicino a una <strong className="text-zinc-400">tappa</strong> già presente: modifica, foto, sposta o
        rimuovi. Clic altrove: aggiungi punto.
      </p>

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

      <OsmWaterNearby />

      {children}
    </div>
  );
}
