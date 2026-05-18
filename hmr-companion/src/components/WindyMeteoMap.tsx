"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StoredCoord } from "@/lib/track-coords";
import type { WindyMapForecastApi } from "@/types/windy-map-forecast";

function loadScriptOnce(src: string): Promise<void> {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Script failed: ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureWindyLibs(): Promise<void> {
  if (typeof window === "undefined") return;
  if (window.windyInit && window.L) return;
  await loadScriptOnce("https://unpkg.com/leaflet@1.4.0/dist/leaflet.js");
  await loadScriptOnce("https://api.windy.com/assets/map-forecast/libBoot.js");
  if (!window.windyInit || !window.L) {
    throw new Error("Windy o Leaflet non disponibili dopo il caricamento.");
  }
}

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 8;
  return Math.min(18, Math.max(3, z));
}

type Props = {
  trackId: string;
  lat: number;
  lng: number;
  zoom: number;
  mode: "radar" | "rain";
};

export default function WindyMeteoMap({ trackId, lat, lng, zoom, mode }: Props) {
  const windyKey = process.env.NEXT_PUBLIC_WINDY_API_KEY?.trim();
  const [error, setError] = useState<string | null>(null);
  const apiRef = useRef<WindyMapForecastApi | null>(null);

  const zoomClamped = useMemo(() => clampZoom(zoom), [zoom]);

  useEffect(() => {
    if (!windyKey) return;

    let cancelled = false;

    (async () => {
      try {
        const r = await fetch(`/api/track/${encodeURIComponent(trackId)}`);
        const j = (await r.json()) as { coords?: StoredCoord[]; error?: string };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        const coords = Array.isArray(j.coords) ? j.coords : [];
        if (coords.length < 2) throw new Error("Traccia senza punti sufficienti.");

        await ensureWindyLibs();
        if (cancelled) return;

        const L = window.L;
        const windyInit = window.windyInit;
        if (!L?.polyline || !windyInit) throw new Error("Libreria meteo non pronta.");

        const latlngs: [number, number][] = coords.map((c) => [c[1], c[0]]);
        const latN = Number.isFinite(lat) ? lat : latlngs[0][0];
        const lonN = Number.isFinite(lng) ? lng : latlngs[0][1];

        const options: {
          key: string;
          lat: number;
          lon: number;
          zoom: number;
          overlay?: string;
          product?: string;
        } = {
          key: windyKey,
          lat: latN,
          lon: lonN,
          zoom: zoomClamped,
        };
        if (mode === "rain") {
          options.overlay = "rain";
          options.product = "ecmwf";
        } else {
          options.overlay = "radar";
        }

        windyInit(options, (windyAPI) => {
          if (cancelled) {
            try {
              windyAPI.map.remove();
            } catch {
              /* ignore */
            }
            return;
          }
          apiRef.current = windyAPI;
          try {
            if (mode === "rain") {
              windyAPI.store.set("product", "ecmwf");
              windyAPI.store.set("overlay", "rain");
            } else {
              windyAPI.store.set("overlay", "radar");
            }
          } catch {
            /* overlay potrebbe non essere nella tier gratuita */
          }

          L.polyline(latlngs, {
            color: "#38bdf8",
            weight: 4,
            opacity: 0.95,
          }).addTo(windyAPI.map);
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Errore caricamento meteo.");
        }
      }
    })();

    return () => {
      cancelled = true;
      const api = apiRef.current;
      apiRef.current = null;
      try {
        api?.map.remove();
      } catch {
        /* ignore */
      }
    };
  }, [trackId, lat, lng, zoomClamped, mode, windyKey]);

  if (!windyKey) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-[color:var(--hmr-bg)] px-4 text-center text-sm text-[color:var(--hmr-muted)]">
        <p>
          Manca <code className="text-[color:var(--hmr-text)]">NEXT_PUBLIC_WINDY_API_KEY</code> nell&apos;ambiente
          Next.
        </p>
        <p className="max-w-md text-xs leading-relaxed text-[color:var(--hmr-faint)]">
          In <strong>locale</strong> (<code className="text-[color:var(--hmr-text)]">npm run dev</code>): aggiungi la
          riga nella root dell&apos;app <code className="text-[color:var(--hmr-text)]">hmr-companion/.env</code> o{" "}
          <code className="text-[color:var(--hmr-text)]">.env.local</code> — non in{" "}
          <code className="text-[color:var(--hmr-text)]">deploy/.env</code> (quello lo usa solo Docker Compose).
          Poi riavvia il dev server.
        </p>
        <p className="text-xs text-[color:var(--hmr-faint)]">
          In <strong>Docker</strong>: metti la key in <code className="text-[color:var(--hmr-text)]">deploy/.env</code>{" "}
          e rifai <code className="text-[color:var(--hmr-text)]">docker compose build</code> (è una{" "}
          <code className="text-[color:var(--hmr-text)]">NEXT_PUBLIC_*</code>).
        </p>
        <p className="text-xs text-[color:var(--hmr-faint)]">
          Key gratuita:{" "}
          <a className="underline" href="https://api.windy.com/keys" target="_blank" rel="noreferrer">
            api.windy.com/keys
          </a>{" "}
          (Map Forecast).
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-[color:var(--hmr-bg)] px-4 text-center text-sm text-[color:var(--hmr-muted)]">
        <p>{error}</p>
        <p className="text-xs text-[color:var(--hmr-faint)]">
          Windy Map Forecast API —{" "}
          <a className="underline" href="https://api.windy.com/keys" target="_blank" rel="noreferrer">
            api.windy.com/keys
          </a>
        </p>
      </div>
    );
  }

  return <div id="windy" className="h-[100dvh] w-full" />;
}
