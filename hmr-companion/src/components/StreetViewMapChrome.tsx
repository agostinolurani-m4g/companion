"use client";

import { useCallback, useEffect, useState } from "react";
import type { StreetViewAlongItem } from "@/lib/along-media-types";

type Props = {
  trackId: string;
  aroundKm: number | null;
  streetViewPoints: StreetViewAlongItem[];
  onStreetViewLoaded: (items: StreetViewAlongItem[]) => void;
  showStreetViewLayer: boolean;
  onShowStreetViewChange: (v: boolean) => void;
  /** Layout compatto accanto agli altri chip mappa */
  compact?: boolean;
};

export default function StreetViewMapChrome({
  trackId,
  aroundKm,
  streetViewPoints,
  onStreetViewLoaded,
  showStreetViewLayer,
  onShowStreetViewChange,
  compact = true,
}: Props) {
  const [svLoading, setSvLoading] = useState(false);
  const [svMsg, setSvMsg] = useState<string | null>(null);

  const mediaQuery = useCallback(() => {
    const half = 5;
    const base =
      aroundKm != null && Number.isFinite(aroundKm)
        ? `around_km=${encodeURIComponent(aroundKm.toFixed(2))}`
        : "";
    const w = `half_window_km=${half}`;
    return [base, w].filter(Boolean).join("&");
  }, [aroundKm]);

  const streetViewQueryBase = useCallback(() => {
    return [
      mediaQuery(),
      "spacing_km=1.5",
      "max_detour_m=100",
      "max_points=12",
    ]
      .filter(Boolean)
      .join("&");
  }, [mediaQuery]);

  const loadStreetView = useCallback(
    async (opts?: { refresh?: boolean }) => {
      setSvLoading(true);
      setSvMsg(null);
      try {
        const refresh = opts?.refresh ? "&refresh=1" : "";
        const q = `${streetViewQueryBase()}${refresh}`;
        const r = await fetch(`/api/track/${encodeURIComponent(trackId)}/street-view?${q}`);
        const j = (await r.json()) as {
          items?: StreetViewAlongItem[];
          message?: string;
          error?: string;
          configured?: boolean;
          source?: "db" | "live";
          warning?: string;
        };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        const items = Array.isArray(j.items) ? j.items : [];
        onStreetViewLoaded(items);
        if (j.warning) setSvMsg(j.warning);
        else if (items.length === 0) {
          if (j.configured === false && j.message) setSvMsg(j.message);
          else
            setSvMsg(
              j.configured === false
                ? j.message ?? "Nessun punto Street View."
                : "Nessun panorama entro soglia."
            );
        } else if (opts?.refresh) setSvMsg("Aggiornati da Google.");
        else if (j.source === "db") setSvMsg("Da cache locale.");
        else setSvMsg("Salvati in SQLite.");
      } catch (e) {
        setSvMsg(e instanceof Error ? e.message : "Errore");
        onStreetViewLoaded([]);
      } finally {
        setSvLoading(false);
      }
    },
    [trackId, onStreetViewLoaded, streetViewQueryBase]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const q = `${streetViewQueryBase()}&prefetch_only=1`;
      const r = await fetch(`/api/track/${encodeURIComponent(trackId)}/street-view?${q}`);
      if (!r.ok || cancelled) return;
      const j = (await r.json()) as { items?: StreetViewAlongItem[] };
      if (cancelled || !Array.isArray(j.items) || j.items.length === 0) return;
      onStreetViewLoaded(j.items);
    })();
    return () => {
      cancelled = true;
    };
  }, [trackId, streetViewQueryBase, onStreetViewLoaded]);

  const chip = compact
    ? "min-h-0 min-w-0 rounded-none border px-1.5 py-0.5 text-[8px] font-semibold leading-tight sm:text-[9px]"
    : "hmr-chip";

  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 sm:gap-1" title={svMsg ?? undefined}>
      <button
        type="button"
        disabled={svLoading}
        onClick={() => void loadStreetView()}
        className={`${chip} border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] text-[color:var(--hmr-muted)] touch-manipulation`}
      >
        {svLoading ? "…" : "SV"}
      </button>
      <button
        type="button"
        disabled={svLoading}
        onClick={() => void loadStreetView({ refresh: true })}
        title="Aggiorna da Google (quota API)"
        className={`${chip} border-[color:var(--hmr-border)] bg-transparent text-[color:var(--hmr-faint)] touch-manipulation`}
      >
        ↻
      </button>
      <label
        className={`inline-flex cursor-pointer items-center gap-0.5 ${chip} border-[color:var(--hmr-border)] bg-[color:var(--hmr-elev)] text-[color:var(--hmr-muted)]`}
      >
        <input
          type="checkbox"
          className="h-3 w-3 shrink-0 accent-[color:var(--hmr-accent)]"
          checked={showStreetViewLayer}
          onChange={(e) => onShowStreetViewChange(e.target.checked)}
          disabled={streetViewPoints.length === 0}
        />
        <span className="hidden sm:inline">mappa</span>
      </label>
      {streetViewPoints.length > 0 && (
        <span className="text-[8px] tabular-nums text-[color:var(--hmr-faint)] sm:text-[9px]">
          {streetViewPoints.length}
        </span>
      )}
    </div>
  );
}
