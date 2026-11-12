import type { Map as MaplibreMap } from "maplibre-gl";

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Layer heatmap "I miei giri" (scope personale, include Strava) e "Community"
 * (solo tracce condivise con consenso). Inseriti sotto il percorso pianificato.
 */
export type HeatScope = "me" | "community";

export const HEAT_SOURCE: Record<HeatScope, string> = { me: "v2-heat-me", community: "v2-heat-community" };
const HEAT_LAYER: Record<HeatScope, string> = { me: "v2-heat-me-layer", community: "v2-heat-community-layer" };
export const UNTRODDEN_SOURCE = "v2-untrodden";
const UNTRODDEN_LAYER = "v2-untrodden-line";

/** Rampe: community calda (giallo→rosso), personale fredda (ciano→blu→viola). */
const RAMPS: Record<HeatScope, unknown[]> = {
  community: [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0,
    "rgba(255,255,178,0)",
    0.15,
    "rgba(254,217,118,0.55)",
    0.4,
    "rgba(253,141,60,0.75)",
    0.7,
    "rgba(240,59,32,0.85)",
    1,
    "rgba(189,0,38,0.95)",
  ],
  me: [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0,
    "rgba(224,243,248,0)",
    0.15,
    "rgba(116,196,230,0.55)",
    0.4,
    "rgba(49,130,206,0.75)",
    0.7,
    "rgba(84,39,180,0.85)",
    1,
    "rgba(63,0,125,0.95)",
  ],
};

function beforeRoute(map: MaplibreMap): string | undefined {
  for (const id of ["v2-route-preview", "v2-route"]) {
    if (map.getLayer(id)) return id;
  }
  const first = map.getStyle()?.layers?.find((l) => l.id.startsWith("v2-"));
  return first?.id;
}

export function ensureHeatLayers(map: MaplibreMap): void {
  for (const scope of ["community", "me"] as const) {
    if (!map.getSource(HEAT_SOURCE[scope])) map.addSource(HEAT_SOURCE[scope], { type: "geojson", data: EMPTY_FC });
    if (!map.getLayer(HEAT_LAYER[scope])) {
      map.addLayer(
        {
          id: HEAT_LAYER[scope],
          type: "heatmap",
          source: HEAT_SOURCE[scope],
          layout: { visibility: "none" },
          paint: {
            // Peso log: 1 passaggio si vede, 100 non saturano tutto.
            "heatmap-weight": ["interpolate", ["linear"], ["ln", ["+", 1, ["get", "w"]]], 0, 0, 1, 0.35, 5, 1],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 13, 1.1, 16, 1.6],
            "heatmap-radius": ["interpolate", ["exponential", 1.6], ["zoom"], 6, 2, 10, 4, 13, 6, 16, 10, 18, 16],
            "heatmap-opacity": 0.85,
            "heatmap-color": RAMPS[scope] as never,
          },
        },
        beforeRoute(map),
      );
    }
  }
  if (!map.getSource(UNTRODDEN_SOURCE)) map.addSource(UNTRODDEN_SOURCE, { type: "geojson", data: EMPTY_FC });
  if (!map.getLayer(UNTRODDEN_LAYER)) {
    map.addLayer({
      id: UNTRODDEN_LAYER,
      type: "line",
      source: UNTRODDEN_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#f97316",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6],
        "line-dasharray": [1, 1.6],
        "line-opacity": 0.95,
      },
    });
  }
}

export function setHeatVisible(map: MaplibreMap, scope: HeatScope, visible: boolean): void {
  if (map.getLayer(HEAT_LAYER[scope])) {
    map.setLayoutProperty(HEAT_LAYER[scope], "visibility", visible ? "visible" : "none");
  }
}

export function setGeoJsonData(map: MaplibreMap, sourceId: string, data: GeoJSON.FeatureCollection): void {
  const src = map.getSource(sourceId) as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined;
  src?.setData?.(data);
}
