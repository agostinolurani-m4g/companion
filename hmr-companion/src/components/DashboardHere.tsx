"use client";

import { useEffect, useState } from "react";
import type { PoiRow, CheckpointRow, ResupplyRow } from "@/lib/db";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";

export type SurfaceKmBreakdown = {
  asphalt: number;
  gravel: number;
  single: number;
  unknown: number;
};

type NextByCategory = Record<string, (PoiRow & { ahead_km: number }) | undefined>;

type AheadPayload = {
  atKm: number;
  windowKm: number;
  nextByCategory: NextByCategory;
  nextCheckpoint: (CheckpointRow & { ahead_km: number }) | null;
  nextResupply: (ResupplyRow & { ahead_km: number }) | null;
};

export type DashboardHereProps = {
  trackId: string;
  lengthKm: number;
  atKm: number | null;
  atKmIsManual: boolean;
  onManualKmChange: (km: number) => void;
  onRequestGeolocation: () => void;
  geolocationStatus: "idle" | "locating" | "watching" | "denied" | "unavailable";
  myPositionDetourM: number | null;
  /** Ripartizione km per superficie (dopo `snapshot:surface`). */
  surfaceKm?: SurfaceKmBreakdown;
};

export default function DashboardHere({
  trackId,
  lengthKm,
  atKm,
  atKmIsManual,
  onManualKmChange,
  onRequestGeolocation,
  geolocationStatus,
  myPositionDetourM,
  surfaceKm,
}: DashboardHereProps) {
  const [data, setData] = useState<AheadPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (atKm == null) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/track/${encodeURIComponent(trackId)}/ahead?atKm=${encodeURIComponent(
        atKm.toFixed(2)
      )}&windowKm=60`
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as AheadPayload;
        if (!cancelled) setData(j);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Errore");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trackId, atKm]);

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <div className="hmr-panel flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-[color:var(--hmr-muted)] text-xs uppercase tracking-wide">
              Posizione sul percorso
            </span>
            <span className="text-lg font-semibold">
              {atKm != null ? `km ${atKm.toFixed(1)}` : "—"}
              {atKm != null && (
                <span className="ml-2 text-xs text-[color:var(--hmr-muted)]">
                  / {lengthKm.toFixed(0)} km ·{" "}
                  {((atKm / lengthKm) * 100).toFixed(1)}%
                </span>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={onRequestGeolocation}
            className={`hmr-btn hmr-tap ${
              geolocationStatus === "watching" ? "hmr-btn-accent" : ""
            }`}
          >
            {geolocationStatus === "watching"
              ? "GPS attivo"
              : geolocationStatus === "locating"
                ? "Cerco…"
                : "GPS"}
          </button>
        </div>
        {geolocationStatus === "denied" && (
          <span className="text-xs text-[color:var(--hmr-warn)]">
            Geolocalizzazione negata. Concedi i permessi o inserisci il km manualmente.
          </span>
        )}
        {geolocationStatus === "unavailable" && (
          <span className="text-xs text-[color:var(--hmr-warn)]">
            GPS non disponibile: inserisci il km manualmente.
          </span>
        )}
        {atKm != null && myPositionDetourM != null && !atKmIsManual && (
          <span className="text-xs text-[color:var(--hmr-muted)]">
            Sei a {formatDetour(myPositionDetourM)} dalla traccia.
          </span>
        )}
        <label className="flex items-center gap-2 text-xs text-[color:var(--hmr-muted)]">
          <span>Manuale</span>
          <input
            type="range"
            min={0}
            max={lengthKm}
            step={0.5}
            value={atKm ?? 0}
            onChange={(e) => onManualKmChange(Number(e.target.value))}
            className="flex-1 accent-[color:var(--hmr-accent)]"
          />
          <input
            type="number"
            value={atKm != null ? Number(atKm.toFixed(1)) : 0}
            min={0}
            max={lengthKm}
            step={0.5}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onManualKmChange(v);
            }}
            className="w-20 rounded-md border border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] px-2 py-1 text-right text-xs"
          />
        </label>
      </div>

      {surfaceKm &&
        surfaceKm.asphalt + surfaceKm.gravel + surfaceKm.single + surfaceKm.unknown > 0.5 && (
          <div className="hmr-panel px-3 py-2 text-xs">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">
              Superficie percorso (stima OSM)
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[color:var(--hmr-text)]">
              <span>
                <span className="text-[color:var(--hmr-faint)]">Asfalto</span>{" "}
                {surfaceKm.asphalt.toFixed(0)} km
              </span>
              <span>
                <span className="text-[color:var(--hmr-faint)]">Sterrato</span>{" "}
                {surfaceKm.gravel.toFixed(0)} km
              </span>
              <span>
                <span className="text-[color:var(--hmr-faint)]">Single / sentiero</span>{" "}
                {surfaceKm.single.toFixed(0)} km
              </span>
              {surfaceKm.unknown > 1 && (
                <span className="text-[color:var(--hmr-faint)]">
                  Non class. {surfaceKm.unknown.toFixed(0)} km
                </span>
              )}
            </div>
          </div>
        )}

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--hmr-muted)]">
          Prossimo nei 60 km
        </h3>
        {loading && !data && (
          <div className="hmr-panel p-3 text-xs text-[color:var(--hmr-muted)]">Carico…</div>
        )}
        {error && (
          <div className="hmr-panel p-3 text-xs text-[color:var(--hmr-danger)]">Errore: {error}</div>
        )}
        {data && (
          <>
            <div className="hmr-panel flex flex-col divide-y divide-[color:var(--hmr-border)]/60 overflow-hidden">
              {data.nextCheckpoint && (
                <SummaryRow
                  color="#f87171"
                  badge="CP"
                  label={data.nextCheckpoint.name}
                  meta={
                    data.nextCheckpoint.notes ?? undefined
                  }
                  ahead={data.nextCheckpoint.ahead_km}
                />
              )}
              {data.nextResupply && (
                <SummaryRow
                  color="#fde68a"
                  badge="RS"
                  label={`Resupply · ${data.nextResupply.name}`}
                  meta={data.nextResupply.notes || undefined}
                  ahead={data.nextResupply.ahead_km}
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORY_ORDER.map((cat) => {
                const n = data.nextByCategory[cat];
                const meta = CATEGORY_META[cat];
                return (
                  <div
                    key={cat}
                    className="hmr-panel flex items-center gap-2 p-3"
                    style={{ borderLeft: `3px solid ${meta.color}` }}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="text-xs uppercase tracking-wide text-[color:var(--hmr-muted)]">
                        {meta.label}
                      </span>
                      {n ? (
                        <>
                          <span className="truncate text-sm font-medium">
                            +{n.ahead_km.toFixed(1)} km
                          </span>
                          <span className="truncate text-xs text-[color:var(--hmr-muted)]">
                            {n.name ?? n.sub_kind ?? "POI"}
                            {n.detour_m ? ` · +${n.detour_m} m` : ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm text-[color:var(--hmr-faint)]">
                          niente vicino
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryRow({
  color,
  badge,
  label,
  meta,
  ahead,
}: {
  color: string;
  badge: string;
  label: string;
  meta?: string;
  ahead: number;
}) {
  return (
    <div className="flex items-start gap-3 p-3">
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-none text-[10px] font-bold tracking-tight"
        style={{ background: `${color}33`, color }}
      >
        {badge}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold">{label}</span>
        {meta && <span className="truncate text-xs text-[color:var(--hmr-muted)]">{meta}</span>}
      </div>
      <span className="ml-auto shrink-0 rounded-full bg-[color:var(--hmr-elev)] px-2 py-0.5 text-xs font-medium">
        +{ahead.toFixed(1)} km
      </span>
    </div>
  );
}

function formatDetour(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
