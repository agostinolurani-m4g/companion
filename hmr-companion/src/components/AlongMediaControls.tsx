"use client";

import { useCallback, useEffect, useState } from "react";
import type { StreetViewAlongItem } from "@/lib/along-media-types";

type Props = {
  trackId: string;
  /** Km attorno a cui interrogare le API (pin misura, posizione, …). */
  aroundKm: number | null;
  /** Testo breve per l’utente (origine del centro). */
  aroundDescription: string;
  lengthKm: number;
  streetViewPoints: StreetViewAlongItem[];
  onStreetViewLoaded: (items: StreetViewAlongItem[]) => void;
  showStreetViewLayer: boolean;
  onShowStreetViewChange: (v: boolean) => void;
};

export default function AlongMediaControls({
  trackId,
  aroundKm,
  aroundDescription,
  lengthKm,
  streetViewPoints,
  onStreetViewLoaded,
  showStreetViewLayer,
  onShowStreetViewChange,
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
        const r = await fetch(
          `/api/track/${encodeURIComponent(trackId)}/street-view?${q}`
        );
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
        if (j.warning) {
          setSvMsg(j.warning);
        } else if (items.length === 0) {
          if (j.configured === false && j.message) setSvMsg(j.message);
          else
            setSvMsg(
              j.configured === false
                ? j.message ?? "Nessun punto Street View trovato vicino al percorso."
                : "Nessun panorama Street View entro la soglia dal percorso (normale in montagna)."
            );
        } else if (opts?.refresh) {
          setSvMsg("Aggiornati da Google e salvati in SQLite.");
        } else if (j.source === "db") {
          setSvMsg("Caricati da salvataggio locale (nessuna chiamata Google).");
        } else {
          setSvMsg("Salvati in SQLite; le prossime volte userai la cache per questo tratto.");
        }
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
      const r = await fetch(
        `/api/track/${encodeURIComponent(trackId)}/street-view?${q}`
      );
      if (!r.ok || cancelled) return;
      const j = (await r.json()) as {
        items?: StreetViewAlongItem[];
        source?: string;
      };
      if (cancelled || !Array.isArray(j.items) || j.items.length === 0) return;
      onStreetViewLoaded(j.items);
    })();
    return () => {
      cancelled = true;
    };
  }, [trackId, streetViewQueryBase, onStreetViewLoaded]);

  return (
    <div className="hmr-panel flex flex-col gap-3 p-3 text-sm">
      <div className="text-[color:var(--hmr-muted)] text-xs uppercase tracking-wide">
        Street View lungo il percorso
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="hmr-btn hmr-tap text-xs"
            disabled={svLoading}
            onClick={() => void loadStreetView()}
          >
            {svLoading ? "Carico…" : "Street View"}
          </button>
          <button
            type="button"
            className="hmr-btn hmr-tap border border-[color:var(--hmr-border)] bg-transparent text-xs"
            disabled={svLoading}
            onClick={() => void loadStreetView({ refresh: true })}
            title="Rifare le chiamate a Google per questa finestra km (usa la quota API)"
          >
            Aggiorna da Google
          </button>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[color:var(--hmr-muted)]">
            <input
              type="checkbox"
              checked={showStreetViewLayer}
              onChange={(e) => onShowStreetViewChange(e.target.checked)}
              disabled={streetViewPoints.length === 0}
            />
            Mostra in mappa
          </label>
          {streetViewPoints.length > 0 && (
            <span className="text-xs text-[color:var(--hmr-muted)]">
              {streetViewPoints.length} punti
            </span>
          )}
        </div>
        {svMsg && (
          <p
            className={`text-xs ${
              svMsg.startsWith("Aggiornati") ||
              svMsg.includes("salvataggio locale") ||
              svMsg.startsWith("Salvati in SQLite")
                ? "text-[color:var(--hmr-muted)]"
                : "text-[color:var(--hmr-warn)]"
            }`}
          >
            {svMsg}
          </p>
        )}
        <p className="text-[10px] leading-snug text-[color:var(--hmr-faint)]">
          Cerca circa <strong>10 km</strong> di traccia centrati su:{" "}
          <span className="text-[color:var(--hmr-muted)]">{aroundDescription}</span>
          {aroundKm != null && (
            <span> (riferimento ~km {aroundKm.toFixed(1)})</span>
          )}
          {aroundKm == null && (
            <span> (riferimento ~km {(lengthKm / 2).toFixed(0)} sul server)</span>
          )}
          . Meno chiamate a Google. Serve <code className="rounded bg-black/10 px-1">GOOGLE_MAPS_API_KEY</code>; i
          punti si salvano in <code className="rounded bg-black/10 px-1">track_street_view_points</code>. Clic sui
          marker in mappa per aprire il viewer.
        </p>
      </div>
    </div>
  );
}
