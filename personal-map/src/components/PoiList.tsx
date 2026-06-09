"use client";

import { useMemo, useState } from "react";
import type { PoiCategory, PoiRow } from "@/lib/db";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";

export type PoiListProps = {
  pois: PoiRow[];
  atKm: number | null;
  lengthKm: number;
  visibleCategories: Set<PoiCategory>;
  onToggleCategory: (c: PoiCategory) => void;
  onSelectPoi?: (poi: PoiRow) => void;
};

export default function PoiList(props: PoiListProps) {
  const [fromKm, setFromKm] = useState<number>(() =>
    props.atKm != null ? Math.max(0, props.atKm - 5) : 0
  );
  const [toKm, setToKm] = useState<number>(() =>
    props.atKm != null ? Math.min(props.lengthKm, props.atKm + 80) : Math.min(props.lengthKm, 80)
  );
  const [maxDetourM, setMaxDetourM] = useState(1500);

  const filtered = useMemo(() => {
    return props.pois
      .filter((p) => props.visibleCategories.has(p.category))
      .filter((p) => p.along_km >= fromKm && p.along_km <= toKm)
      .filter((p) => p.detour_m <= maxDetourM)
      .slice(0, 500);
  }, [props.pois, props.visibleCategories, fromKm, toKm, maxDetourM]);

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <div className="hmr-panel flex flex-col gap-3 p-3">
        <div className="flex min-w-0 max-w-full flex-wrap gap-2">
          {CATEGORY_ORDER.map((cat) => {
            const meta = CATEGORY_META[cat];
            const on = props.visibleCategories.has(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => props.onToggleCategory(cat)}
                className={`hmr-chip hmr-tap ${on ? "hmr-chip-on" : "hmr-chip-off"}`}
                style={
                  on ? { borderColor: `${meta.color}88`, color: meta.color, background: `${meta.color}22` } : undefined
                }
              >
                {meta.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>
            Da km
            <input
              type="number"
              min={0}
              max={props.lengthKm}
              value={fromKm}
              onChange={(e) => setFromKm(Number(e.target.value))}
              className="mt-1 w-full rounded border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-1"
            />
          </label>
          <label>
            A km
            <input
              type="number"
              min={0}
              max={props.lengthKm}
              value={toKm}
              onChange={(e) => setToKm(Number(e.target.value))}
              className="mt-1 w-full rounded border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-1"
            />
          </label>
        </div>
        <label className="text-xs text-[color:var(--hmr-muted)]">
          Detour max {maxDetourM} m
          <input
            type="range"
            min={100}
            max={3000}
            step={100}
            value={maxDetourM}
            onChange={(e) => setMaxDetourM(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>
      </div>

      <ul className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <li className="text-xs text-[color:var(--hmr-muted)]">Nessun POI nel range.</li>
        ) : (
          filtered.map((p) => {
            const meta = CATEGORY_META[p.category];
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => props.onSelectPoi?.(p)}
                  className="hmr-panel w-full rounded-xl border border-[color:var(--hmr-border)]/60 p-3 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium" style={{ color: meta.color }}>
                      {p.name ?? meta.label}
                    </span>
                    <span className="shrink-0 text-[10px] text-[color:var(--hmr-faint)]">
                      km {p.along_km.toFixed(1)}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-[color:var(--hmr-muted)]">
                    {meta.label}
                    {p.detour_m > 0 ? ` · ${Math.round(p.detour_m)} m dalla traccia` : ""}
                  </p>
                  {p.phone ? (
                    <a href={`tel:${p.phone}`} className="mt-1 block text-xs text-[color:var(--hmr-accent)]">
                      {p.phone}
                    </a>
                  ) : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
