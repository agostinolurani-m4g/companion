/**
 * Windy Map Forecast API (loaded from CDN: libBoot.js + Leaflet 1.4).
 * @see https://api.windy.com/map-forecast/docs
 */
export type WindyMapForecastApi = {
  map: {
    remove: () => void;
  };
  store: {
    set: (key: string, value: unknown, opts?: { forceChange?: boolean }) => void;
    get: (key: string) => unknown;
  };
};

declare global {
  interface Window {
    windyInit?: (
      options: {
        key: string;
        lat: number;
        lon: number;
        zoom: number;
        overlay?: string;
        product?: string;
        verbose?: boolean;
      },
      callback: (api: WindyMapForecastApi) => void
    ) => void;
    L?: {
      polyline: (
        latlngs: [number, number][],
        options?: { color?: string; weight?: number; opacity?: number }
      ) => { addTo: (map: WindyMapForecastApi["map"]) => unknown };
    };
  }
}

export {};
