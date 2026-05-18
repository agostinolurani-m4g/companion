/**
 * Windy Map Forecast API (loaded from CDN: libBoot.js + Leaflet 1.4).
 * @see https://api.windy.com/map-forecast/docs
 */
export type WindyMapForecastApi = {
  map: {
    remove: () => void;
    createPane?: (name: string) => void;
    getPane?: (name: string) => HTMLElement | undefined;
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
    ) => void | Promise<unknown>;
    L?: {
      polyline: (
        latlngs: [number, number][],
        options?: {
          color?: string;
          weight?: number;
          opacity?: number;
          pane?: string;
        }
      ) => {
        addTo: (map: WindyMapForecastApi["map"]) => { bringToFront?: () => void };
      };
    };
  }
}

export {};
