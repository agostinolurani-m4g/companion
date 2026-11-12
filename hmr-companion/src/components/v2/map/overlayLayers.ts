import type { Map as MaplibreMap } from "maplibre-gl";
import type { MapOverlayId } from "@/lib/sports";
import {
  OVERLAY_ATTRIBUTION,
  OVERLAY_TILE_URLS,
  overlayLayerId,
  overlaySourceId,
} from "@/lib/map/overlay-urls";
import { SLOPE_TILES_URL } from "@/lib/ski-overlays";
import { pickStyleFont } from "@/lib/map/topo-style";
import {
  AVALANCHE_FILL_COLOR,
  EMPTY_FC,
  ROUTE_LINE_WIDTH,
  WAYPOINT_HALO_RADIUS,
} from "./constants";
import { addOutdoorFeatureLayers } from "./featuresLayers";

/** Colore percorso di default (quando non colorato per superficie). */
export const ROUTE_DEFAULT_COLOR = "#8f7fd1";
const ARROW_IMAGE = "v2-route-arrow";

function addRasterOverlay(
  map: MaplibreMap,
  sourceId: string,
  layerId: string,
  tilesUrl: string,
  visible: boolean,
  opacity: number,
) {
  if (!tilesUrl || map.getSource(sourceId)) return;
  map.addSource(sourceId, {
    type: "raster",
    tiles: [tilesUrl],
    tileSize: 256,
    maxzoom: 16,
  });
  map.addLayer({
    id: layerId,
    type: "raster",
    source: sourceId,
    paint: { "raster-opacity": opacity, "raster-fade-duration": 200 },
    layout: { visibility: visible ? "visible" : "none" },
  });
}

/** Chevron bianco con bordo scuro, disegnato su canvas (nessun asset esterno). */
function ensureArrowImage(map: MaplibreMap) {
  if (map.hasImage(ARROW_IMAGE)) return;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(11, 9);
    ctx.lineTo(20, 16);
    ctx.lineTo(11, 23);
  };
  path();
  ctx.strokeStyle = "rgba(15,23,42,0.55)";
  ctx.lineWidth = 6;
  ctx.stroke();
  path();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3.2;
  ctx.stroke();
  const data = ctx.getImageData(0, 0, size, size);
  map.addImage(ARROW_IMAGE, { width: size, height: size, data: new Uint8Array(data.data.buffer) }, { pixelRatio: 2 });
}

export type OverlayLayerOptions = {
  slopeVisible: boolean;
  slopeOpacity: number;
  avalancheVisible: boolean;
  avalancheOpacity: number;
  sportOverlays?: Partial<Record<MapOverlayId, boolean>>;
};

export function addSportRasterOverlays(map: MaplibreMap, opts: OverlayLayerOptions): void {
  const sportOverlays = opts.sportOverlays ?? {};
  for (const [id, url] of Object.entries(OVERLAY_TILE_URLS) as [MapOverlayId, string | null][]) {
    if (!url || id === "slope") continue;
    const visible = sportOverlays[id] ?? false;
    addRasterOverlay(map, overlaySourceId(id), overlayLayerId(id), url, visible, 0.75);
  }
}

export function setSportOverlayVisibility(
  map: MaplibreMap,
  sportOverlays: Partial<Record<MapOverlayId, boolean>>,
): void {
  for (const id of Object.keys(OVERLAY_TILE_URLS) as MapOverlayId[]) {
    const layerId = overlayLayerId(id);
    if (!map.getLayer(layerId)) continue;
    const visible = sportOverlays[id] ?? false;
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

export function addOverlaySourcesAndLayers(map: MaplibreMap, opts: OverlayLayerOptions): void {
  if (map.getSource("v2-route")) return;
  const font = pickStyleFont(map);
  ensureArrowImage(map);

  addRasterOverlay(map, "ski-slope", "ski-slope", SLOPE_TILES_URL, opts.slopeVisible, opts.slopeOpacity);
  addSportRasterOverlays(map, opts);

  map.addSource("ski-avalanche", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "ski-avalanche-fill",
    type: "fill",
    source: "ski-avalanche",
    paint: {
      "fill-color": AVALANCHE_FILL_COLOR,
      "fill-opacity": opts.avalancheOpacity,
    },
    layout: { visibility: opts.avalancheVisible ? "visible" : "none" },
  });
  map.addLayer({
    id: "ski-avalanche-line",
    type: "line",
    source: "ski-avalanche",
    paint: {
      "line-color": "#0f172a",
      "line-width": 0.6,
      "line-opacity": opts.avalancheVisible ? opts.avalancheOpacity * 0.5 : 0,
    },
    layout: { visibility: opts.avalancheVisible ? "visible" : "none" },
  });

  map.addSource("v2-poi-radius", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "v2-poi-radius",
    type: "fill",
    source: "v2-poi-radius",
    paint: { "fill-color": "#fb923c", "fill-opacity": 0.05 },
  });
  map.addLayer({
    id: "v2-poi-radius-line",
    type: "line",
    source: "v2-poi-radius",
    paint: { "line-color": "#fb923c", "line-width": 1.2, "line-opacity": 0.5, "line-dasharray": [2, 2] },
  });

  // Dati outdoor (rifugi, sorgenti, …) sotto percorso e tappe.
  addOutdoorFeatureLayers(map);

  /* ── Anteprima tratteggiata tra le tappe (durante il calcolo del percorso) ── */
  map.addSource("v2-route-preview", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "v2-route-preview",
    type: "line",
    source: "v2-route-preview",
    layout: { "line-cap": "round" },
    paint: {
      "line-color": ROUTE_DEFAULT_COLOR,
      "line-width": 2.5,
      "line-opacity": 0.75,
      "line-dasharray": [1.5, 2],
    },
  });

  /* ── Percorso: linea senza contorno, frecce di direzione ── */
  map.addSource("v2-route", { type: "geojson", data: EMPTY_FC, lineMetrics: true });
  map.addLayer({
    id: "v2-route",
    type: "line",
    source: "v2-route",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": ["coalesce", ["get", "color"], ROUTE_DEFAULT_COLOR],
      "line-width": ROUTE_LINE_WIDTH,
      "line-opacity": ["case", ["==", ["get", "dimmed"], true], 0.35, 1],
    },
  });
  map.addLayer({
    id: "v2-route-arrows",
    type: "symbol",
    source: "v2-route",
    minzoom: 11,
    filter: ["!=", ["get", "dimmed"], true],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": ["interpolate", ["linear"], ["zoom"], 11, 70, 16, 120],
      "icon-image": ARROW_IMAGE,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.7, 16, 1],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-rotation-alignment": "map",
      "icon-keep-upright": false,
    },
  });
  map.addLayer({
    id: "v2-route-hit",
    type: "line",
    source: "v2-route",
    paint: { "line-color": "#000000", "line-width": 16, "line-opacity": 0 },
  });

  map.addSource("v2-route-markers", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "v2-route-markers",
    type: "circle",
    source: "v2-route-markers",
    paint: {
      "circle-radius": 7,
      "circle-color": ["get", "color"],
    },
  });

  /* ── POI ricerca ── */
  map.addSource("v2-pois", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "v2-pois",
    type: "circle",
    source: "v2-pois",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 13, 6, 16, 8],
      "circle-color": ["get", "color"],
    },
  });
  map.addLayer({
    id: "v2-pois-label",
    type: "symbol",
    source: "v2-pois",
    minzoom: 13.5,
    layout: {
      "text-field": ["get", "name"],
      "text-font": font,
      "text-size": 11.5,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-max-width": 9,
      "text-optional": true,
    },
    paint: {
      "text-color": "#1f2937",
      "text-halo-color": "rgba(255,255,255,0.95)",
      "text-halo-width": 1.6,
    },
  });
  map.addLayer({
    id: "v2-pois-hit",
    type: "circle",
    source: "v2-pois",
    paint: { "circle-radius": 14, "circle-opacity": 0 },
  });

  map.addSource("v2-pending", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "v2-pending-halo",
    type: "circle",
    source: "v2-pending",
    paint: { "circle-radius": 20, "circle-color": "#fbbf24", "circle-opacity": 0.22 },
  });
  map.addLayer({
    id: "v2-pending",
    type: "circle",
    source: "v2-pending",
    paint: {
      "circle-radius": 8,
      "circle-color": "#fbbf24",
      "circle-stroke-width": 3,
      "circle-stroke-color": "#ffffff",
    },
  });

  map.addSource("v2-photos", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "v2-photos",
    type: "circle",
    source: "v2-photos",
    paint: {
      "circle-radius": 7,
      "circle-color": "#ec4899",
      "circle-stroke-width": 2.5,
      "circle-stroke-color": "#ffffff",
    },
  });

  /* ── Soste della gita (partenza, arrivo, rifugi, spesa…) ── */
  map.addSource("v2-outing-stops", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "v2-outing-stops",
    type: "circle",
    source: "v2-outing-stops",
    paint: {
      "circle-radius": ["match", ["get", "role"], "stop", 7, 8.5],
      "circle-color": [
        "match",
        ["get", "role"],
        "start",
        "#22c55e",
        "end",
        "#ef4444",
        [
          "match",
          ["get", "kind"],
          "hut", "#ef4444",
          "bivouac", "#f97316",
          "lodging", "#a78bfa",
          "restaurant", "#fb923c",
          "supermarket", "#22c55e",
          "water", "#38bdf8",
          "parking", "#94a3b8",
          "transport", "#64748b",
          "viewpoint", "#f59e0b",
          "#cbd5e1",
        ],
      ],
      "circle-stroke-width": ["match", ["get", "role"], "stop", 2, 3],
      "circle-stroke-color": "#ffffff",
    },
  });

  map.addSource("v2-reports", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "v2-reports",
    type: "circle",
    source: "v2-reports",
    paint: {
      "circle-radius": ["case", ["get", "verified"], 9, 7.5],
      "circle-color": ["get", "color"],
      "circle-stroke-width": ["case", ["get", "verified"], 3, 2],
      "circle-stroke-color": ["case", ["get", "verified"], "#fbbf24", "#ffffff"],
    },
  });
  map.addLayer({
    id: "v2-reports-hit",
    type: "circle",
    source: "v2-reports",
    paint: { "circle-radius": 16, "circle-opacity": 0 },
  });

  /* ── Marker hover dal profilo altimetrico ── */
  map.addSource("v2-hover", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "v2-hover-halo",
    type: "circle",
    source: "v2-hover",
    paint: { "circle-radius": 14, "circle-color": "#8f7fd1", "circle-opacity": 0.25 },
  });
  map.addLayer({
    id: "v2-hover",
    type: "circle",
    source: "v2-hover",
    paint: {
      "circle-radius": 6,
      "circle-color": "#8f7fd1",
      "circle-stroke-width": 3,
      "circle-stroke-color": "#ffffff",
    },
  });

  /* ── Tappe: partenza verde, arrivo rosso, intermedie numerate ── */
  map.addSource("v2-waypoints", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "v2-waypoints-halo",
    type: "circle",
    source: "v2-waypoints",
    paint: {
      "circle-radius": WAYPOINT_HALO_RADIUS,
      // Invisibile: resta solo come area cliccabile/trascinabile.
      "circle-color": "#0b1221",
      "circle-opacity": 0,
    },
  });
  map.addLayer({
    id: "v2-waypoints",
    type: "circle",
    source: "v2-waypoints",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 7, 13, 10, 17, 13],
      "circle-color": [
        "match",
        ["get", "role"],
        "start",
        "#3f8f86",
        "end",
        "#7d6bc4",
        "single",
        "#3f8f86",
        "#1e293b",
      ],
    },
  });
  map.addLayer({
    id: "v2-waypoints-label",
    type: "symbol",
    source: "v2-waypoints",
    layout: {
      "text-field": ["to-string", ["get", "idx"]],
      "text-font": font,
      "text-size": ["interpolate", ["linear"], ["zoom"], 8, 9, 13, 11, 17, 13],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  /* ── Posizione utente (cerchio precisione) ── */
  map.addSource("v2-user-acc", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "v2-user-acc",
    type: "fill",
    source: "v2-user-acc",
    paint: { "fill-color": "#8f7fd1", "fill-opacity": 0.12 },
  });
  map.addLayer({
    id: "v2-user-acc-line",
    type: "line",
    source: "v2-user-acc",
    paint: { "line-color": "#8f7fd1", "line-width": 1, "line-opacity": 0.45 },
  });

}

export function overlayAttributionLine(): string {
  const parts = ["© OpenStreetMap", "© OpenFreeMap"];
  for (const v of Object.values(OVERLAY_ATTRIBUTION)) {
    if (v) parts.push(v);
  }
  return parts.join(" · ");
}
