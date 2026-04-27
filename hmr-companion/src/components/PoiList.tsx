"use client";

import { useMemo, useState } from "react";
import type { PoiCategory, PoiRow, ResupplyRow } from "@/lib/db";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";

export type PoiListProps = {
  pois: PoiRow[];
  resupply: ResupplyRow[];
  atKm: number | null;
  lengthKm: number;
  visibleCategories: Set<PoiCategory>;
  onToggleCategory: (c: PoiCategory) => void;
  showResupply: boolean;
  onToggleResupply: () => void;
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

  const resupplyInRange = useMemo(
    () => props.resupply.filter((r) => r.along_km >= fromKm && r.along_km <= toKm),
    [props.resupply, fromKm, toKm]
  );

  const poisByKey = useMemo(() => {
    const map = new Map<
      number,
      { km: number; resupply: ResupplyRow[]; pois: PoiRow[] }
    >();
    const keyForKm = (km: number) => Math.floor(km);
    for (const p of filtered) {
      const k = keyForKm(p.along_km);
      const row = map.get(k) ?? { km: k, resupply: [], pois: [] };
      row.pois.push(p);
      map.set(k, row);
    }
    if (props.showResupply) {
      for (const r of resupplyInRange) {
        const k = keyForKm(r.along_km);
        const row = map.get(k) ?? { km: k, resupply: [], pois: [] };
        row.resupply.push(r);
        map.set(k, row);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.km - b.km);
  }, [filtered, resupplyInRange, props.showResupply]);

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <div className="hmr-panel flex flex-col gap-3 p-3">
        <div className="flex flex-wrap gap-2">
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
                <span aria-hidden>{meta.emoji}</span>
                {meta.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={props.onToggleResupply}
            className={`hmr-chip hmr-tap ${props.showResupply ? "hmr-chip-on" : "hmr-chip-off"}`}
          >
            🧭 Resupply
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <label className="flex items-center gap-2 text-xs text-[color:var(--hmr-muted)]">
            <span className="w-12 shrink-0">da km</span>
            <input
              type="range"
              min={0}
              max={props.lengthKm}
              step={1}
              value={fromKm}
              onChange={(e) => setFromKm(Math.min(Number(e.target.value), toKm - 1))}
              className="flex-1 accent-[color:var(--hmr-accent)]"
            />
            <span className="w-12 text-right text-[color:var(--hmr-text)]">
              {fromKm.toFixed(0)}
            </span>
          </label>
          <label className="flex items-center gap-2 text-xs text-[color:var(--hmr-muted)]">
            <span className="w-12 shrink-0">a km</span>
            <input
              type="range"
              min={0}
              max={props.lengthKm}
              step={1}
              value={toKm}
              onChange={(e) => setToKm(Math.max(Number(e.target.value), fromKm + 1))}
              className="flex-1 accent-[color:var(--hmr-accent)]"
            />
            <span className="w-12 text-right text-[color:var(--hmr-text)]">
              {toKm.toFixed(0)}
            </span>
          </label>
          <label className="flex items-center gap-2 text-xs text-[color:var(--hmr-muted)]">
            <span className="w-12 shrink-0">detour</span>
            <input
              type="range"
              min={100}
              max={3000}
              step={100}
              value={maxDetourM}
              onChange={(e) => setMaxDetourM(Number(e.target.value))}
              className="flex-1 accent-[color:var(--hmr-accent)]"
            />
            <span className="w-16 text-right text-[color:var(--hmr-text)]">
              ≤ {maxDetourM} m
            </span>
          </label>
        </div>
        {props.atKm != null && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const a = props.atKm ?? 0;
                setFromKm(Math.max(0, a - 2));
                setToKm(Math.min(props.lengthKm, a + 40));
              }}
              className="hmr-btn hmr-btn-accent hmr-tap text-xs"
            >
              Prossimi 40 km
            </button>
            <button
              type="button"
              onClick={() => {
                setFromKm(0);
                setToKm(props.lengthKm);
              }}
              className="hmr-btn hmr-tap text-xs"
            >
              Tutto
            </button>
          </div>
        )}
        <p className="text-xs text-[color:var(--hmr-muted)]">
          {filtered.length} POI · {resupplyInRange.length} resupply
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {poisByKey.length === 0 && (
          <div className="hmr-panel p-4 text-center text-sm text-[color:var(--hmr-muted)]">
            Nessun POI nel filtro corrente.
          </div>
        )}
        {poisByKey.map((row) => (
          <div key={row.km} className="hmr-panel overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[color:var(--hmr-border)]/60 bg-[color:var(--hmr-elev)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">
              <span>km {row.km}</span>
              {props.atKm != null && (
                <span className="ml-auto text-[color:var(--hmr-accent)]">
                  {row.km - props.atKm >= 0
                    ? `+${(row.km - props.atKm).toFixed(1)}`
                    : `${(row.km - props.atKm).toFixed(1)}`}{" "}
                  km
                </span>
              )}
            </div>
            <div className="divide-y divide-[color:var(--hmr-border)]/60">
              {row.resupply.map((r) => (
                <div key={r.id} className="flex items-start gap-3 px-3 py-2">
                  <span
                    aria-hidden
                    className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-300"
                  >
                    🧭
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {r.name}{" "}
                      <span className="text-xs text-[color:var(--hmr-muted)]">
                        · resupply ufficiale
                      </span>
                    </span>
                    {r.notes && (
                      <span className="text-xs text-[color:var(--hmr-muted)]">{r.notes}</span>
                    )}
                  </div>
                  <a
                    href={`https://maps.google.com/?q=${r.lat},${r.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hmr-btn hmr-tap text-xs"
                  >
                    Maps
                  </a>
                </div>
              ))}
              {row.pois.map((p) => (
                <PoiCard key={p.id} poi={p} onSelect={props.onSelectPoi} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PoiCard({ poi, onSelect }: { poi: PoiRow; onSelect?: (p: PoiRow) => void }) {
  const meta = CATEGORY_META[poi.category];
  return (
    <div className="flex items-start gap-3 px-3 py-2">
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm"
        style={{ background: `${meta.color}33`, color: meta.color }}
      >
        {meta.emoji}
      </span>
      <button
        type="button"
        onClick={() => onSelect?.(poi)}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
      >
        <span className="truncate text-sm font-medium">
          {poi.name ?? `${meta.label} (senza nome)`}
        </span>
        <span className="truncate text-xs text-[color:var(--hmr-muted)]">
          {poi.sub_kind ?? meta.label}
          {poi.detour_m != null && ` · +${poi.detour_m} m dalla traccia`}
          {poi.elev_delta_m != null &&
            poi.elev_delta_m !== 0 &&
            ` · Δ ${poi.elev_delta_m > 0 ? "+" : ""}${poi.elev_delta_m} m`}
          {poi.opening_hours ? ` · ${poi.opening_hours}` : ""}
        </span>
        {poi.phone && (
          <a
            href={`tel:${poi.phone}`}
            className="mt-0.5 text-xs text-[color:var(--hmr-accent)]"
            onClick={(e) => e.stopPropagation()}
          >
            📞 {poi.phone}
          </a>
        )}
      </button>
      <div className="flex flex-col gap-1">
        <a
          href={`https://maps.google.com/?q=${poi.lat},${poi.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hmr-btn hmr-tap text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          Maps
        </a>
        {poi.website && (
          <a
            href={poi.website}
            target="_blank"
            rel="noopener noreferrer"
            className="hmr-btn hmr-tap text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            Sito
          </a>
        )}
      </div>
    </div>
  );
}
