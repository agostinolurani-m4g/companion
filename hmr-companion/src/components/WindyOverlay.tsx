"use client";

import { useMemo } from "react";

export type WindyMode = "radar" | "rain";

type Props = {
  trackId: string;
  lat: number;
  lng: number;
  zoom: number;
  mode: WindyMode;
  onModeChange: (m: WindyMode) => void;
  onClose: () => void;
};

function buildMeteoPageUrl(trackId: string, lat: number, lng: number, zoom: number, mode: WindyMode): string {
  const qs = new URLSearchParams({
    lat: lat.toFixed(6),
    lng: lng.toFixed(6),
    zoom: String(Math.round(zoom * 100) / 100),
    mode,
  });
  return `/track/${encodeURIComponent(trackId)}/meteo?${qs.toString()}`;
}

export default function WindyOverlay({
  trackId,
  lat,
  lng,
  zoom,
  mode,
  onModeChange,
  onClose,
}: Props) {
  const src = useMemo(
    () => buildMeteoPageUrl(trackId, lat, lng, zoom, mode),
    [trackId, lat, lng, zoom, mode]
  );

  return (
    <div
      className="fixed inset-0 z-[32] flex flex-col bg-[color:var(--hmr-bg)]"
      role="dialog"
      aria-modal="true"
      aria-label="Mappa meteo Windy"
    >
      <div className="pointer-events-auto flex shrink-0 items-center gap-1 border-b border-[color:var(--hmr-border)] bg-[color:var(--hmr-panel-bg)] px-2 py-1.5 pt-[calc(var(--safe-top)+0.35rem)] shadow-sm">
        <div className="flex flex-1 flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => onModeChange("radar")}
            className={`hmr-chip max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px] ${
              mode === "radar" ? "hmr-chip-on" : "hmr-chip-off"
            }`}
          >
            Radar
          </button>
          <button
            type="button"
            onClick={() => onModeChange("rain")}
            className={`hmr-chip max-sm:!min-h-[26px] max-sm:!px-1.5 max-sm:!py-0 max-sm:!text-[8px] sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[9px] ${
              mode === "rain" ? "hmr-chip-on" : "hmr-chip-off"
            }`}
          >
            Pioggia
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="hmr-btn hmr-tap shrink-0 rounded-none px-2.5 py-1 text-xs font-semibold"
          aria-label="Chiudi meteo"
        >
          ×
        </button>
      </div>
      <iframe
        key={src}
        title="Windy"
        src={src}
        className="min-h-0 w-full flex-1 border-0"
        allow="geolocation; fullscreen"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
