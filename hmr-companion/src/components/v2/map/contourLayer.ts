import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import mlcontour from "maplibre-contour";
import { firstSymbolLayer, OPEN_DEM_TILES, pickStyleFont, reliefInsertBefore } from "@/lib/map/topo-style";

const SOURCE_ID = "contour-src";
const LINE_ID = "contour-lines";
const LABEL_ID = "contour-labels";

type DemSourceT = InstanceType<typeof mlcontour.DemSource>;
let demSource: DemSourceT | null = null;

/** DemSource condiviso (cache tile DEM + worker), registrato una sola volta su maplibre. */
function getDemSource(): DemSourceT {
  if (demSource) return demSource;
  demSource = new mlcontour.DemSource({
    url: OPEN_DEM_TILES,
    encoding: "terrarium",
    maxzoom: 13,
    // Il worker blob di maplibre-contour va in timeout col bundler: calcolo sul main thread (tile piccoli, cache).
    worker: false,
    timeoutMs: 30_000,
    cacheSize: 120,
  });
  demSource.setupMaplibre(maplibregl);
  return demSource;
}

/**
 * Curve di livello (isoipse) calcolate dal DEM: maestre ogni 100–500 m con etichetta,
 * intermedie più fitte allo zoom alto. Inserite sotto strade ed etichette del basemap.
 */
export function ensureContourLayers(map: MaplibreMap, dark: boolean): void {
  if (map.getSource(SOURCE_ID)) return;
  const dem = getDemSource();
  map.addSource(SOURCE_ID, {
    type: "vector",
    tiles: [
      dem.contourProtocolUrl({
        multiplier: 1,
        thresholds: {
          // zoom: [intermedia, maestra] in metri
          11: [200, 1000],
          12: [100, 500],
          13: [50, 250],
          14: [20, 100],
          15: [10, 50],
        },
        elevationKey: "ele",
        levelKey: "level",
        contourLayer: "contours",
      }),
    ],
    maxzoom: 16,
  });

  const lineColor = dark ? "rgba(160,178,184,0.32)" : "rgba(150,118,88,0.45)";
  const before = reliefInsertBefore(map);
  map.addLayer(
    {
      id: LINE_ID,
      type: "line",
      source: SOURCE_ID,
      "source-layer": "contours",
      minzoom: 11,
      paint: {
        "line-color": lineColor,
        "line-width": ["match", ["get", "level"], 1, 1.1, 0.55],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.5, 13, 0.85],
      },
      layout: { "line-join": "round" },
    },
    before,
  );
  map.addLayer({
    id: LABEL_ID,
    type: "symbol",
    source: SOURCE_ID,
    "source-layer": "contours",
    minzoom: 12.5,
    filter: [">", ["get", "level"], 0],
    layout: {
      "symbol-placement": "line",
      "text-size": 10,
      "text-field": ["concat", ["to-string", ["round", ["get", "ele"]]], " m"],
      "text-font": pickStyleFont(map),
      "text-padding": 12,
      "symbol-spacing": 320,
    },
    paint: {
      "text-color": dark ? "#8f9ba1" : "#8a7058",
      "text-halo-color": dark ? "rgba(26,30,34,0.9)" : "rgba(244,243,239,0.9)",
      "text-halo-width": 1.4,
    },
  }, firstSymbolLayer(map));
}

export function setContourLayerVisible(map: MaplibreMap, visible: boolean): void {
  for (const id of [LINE_ID, LABEL_ID]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}
