"use client";

import { useCallback, useEffect, useState } from "react";
import { isBaseStyleId, listBaseStyleOptions, type BaseStyleId } from "@/lib/map/topo-style";

export type MapPrefs = {
  /** null = scelta automatica in base allo sport. */
  base: BaseStyleId | null;
  hillshade: boolean;
  contours: boolean;
  tint: boolean;
  /** Aspetto mappa: segue il tema dell'app oppure fisso. */
  mapMode: "auto" | "light" | "dark";
  /** Heatmap personale (attività importate, anche Strava: visibile solo a te). */
  heatMe: boolean;
  /** Heatmap community (tracce condivise con consenso). */
  heatCommunity: boolean;
};

const KEY = "hmr.v2.map.prefs.v2";
const DEFAULTS: MapPrefs = {
  base: null,
  hillshade: true,
  contours: true,
  tint: false,
  mapMode: "auto",
  heatMe: false,
  heatCommunity: false,
};

function read(): MapPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<MapPrefs>;
    const allowed = listBaseStyleOptions();
    return {
      base: isBaseStyleId(p.base) && allowed.includes(p.base) ? p.base : null,
      hillshade: typeof p.hillshade === "boolean" ? p.hillshade : DEFAULTS.hillshade,
      contours: typeof p.contours === "boolean" ? p.contours : DEFAULTS.contours,
      tint: typeof p.tint === "boolean" ? p.tint : DEFAULTS.tint,
      mapMode: p.mapMode === "light" || p.mapMode === "dark" || p.mapMode === "auto" ? p.mapMode : DEFAULTS.mapMode,
      heatMe: typeof p.heatMe === "boolean" ? p.heatMe : DEFAULTS.heatMe,
      heatCommunity: typeof p.heatCommunity === "boolean" ? p.heatCommunity : DEFAULTS.heatCommunity,
    };
  } catch {
    return DEFAULTS;
  }
}

/** Preferenze mappa per-dispositivo (basemap, rilievo). */
export function useMapPrefs() {
  const [prefs, setPrefs] = useState<MapPrefs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setPrefs(read());
    setLoaded(true);
  }, []);

  const update = useCallback((patch: Partial<MapPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage non disponibile */
      }
      return next;
    });
  }, []);

  return { prefs, update, loaded };
}
