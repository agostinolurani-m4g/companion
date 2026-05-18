"use client";

import { useMemo } from "react";
import type { PoiRow } from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import { CATEGORY_META } from "@/lib/categories";
import { measureBetween } from "@/lib/track-measure";

export type NextPoiListProps = {
  pois: PoiRow[];
  coords: StoredCoord[];
  atKm: number | null;
  lengthKm: number;
  maxAheadKm?: number;
  maxItems?: number;
  elevProfileGainScale: number;
  elevProfileLossScale: number;
  onSelectPoi?: (poi: PoiRow) => void;
};

export default function NextPoiList({
  pois,
  coords,
  atKm,
  lengthKm,
  maxAheadKm = 120,
  maxItems = 8,
  elevProfileGainScale,
  elevProfileLossScale,
  onSelectPoi,
}: NextPoiListProps) {
  const rows = useMemo(() => {
    if (atKm == null) return [];
    const scale = { profileGainScale: elevProfileGainScale, profileLossScale: elevProfileLossScale };
    const ahead = pois
      .filter((p) => p.along_km >= atKm - 0.05 && p.along_km <= atKm + maxAheadKm)
      .sort((a, b) => a.along_km - b.along_km)
      .slice(0, maxItems);

    return ahead.map((p) => {
      const m = measureBetween(coords, atKm, p.along_km, scale);
      return { poi: p, aheadKm: p.along_km - atKm, gainM: m.gainM };
    });
  }, [pois, coords, atKm, maxAheadKm, maxItems, elevProfileGainScale, elevProfileLossScale]);

  if (atKm == null) {
    return (
      <p className="p-3 text-xs text-[color:var(--hmr-warn)]">
        Attiva GPS o imposta il km nel tab «Qui» per vedere i prossimi POI.
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="p-3 text-xs text-[color:var(--hmr-muted)]">
        Nessun POI in avanti nel filtro corrente (fino a {maxAheadKm} km).
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5 p-2">
      {rows.map(({ poi, aheadKm, gainM }) => {
        const meta = CATEGORY_META[poi.category];
        const label = poi.name ?? meta.label;
        return (
          <li key={poi.id}>
            <button
              type="button"
              onClick={() => onSelectPoi?.(poi)}
              className="hmr-tap flex w-full items-baseline gap-2 rounded-md border border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-elev)]/80 px-2 py-1.5 text-left text-[11px] leading-tight"
            >
              <span
                className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase"
                style={{ background: `${meta.color}33`, color: meta.color }}
              >
                {meta.short}
              </span>
              <span className="min-w-0 flex-1 font-medium text-[color:var(--hmr-text)]">{label}</span>
              <span className="shrink-0 tabular-nums text-[color:var(--hmr-accent)]">
                +{aheadKm.toFixed(1)} km
              </span>
              <span className="shrink-0 tabular-nums text-[color:var(--hmr-muted)]">D+{Math.round(gainM)}</span>
            </button>
          </li>
        );
      })}
      <p className="px-1 text-[9px] text-[color:var(--hmr-faint)]">Traccia {lengthKm.toFixed(0)} km · dati locali</p>
    </ul>
  );
}
