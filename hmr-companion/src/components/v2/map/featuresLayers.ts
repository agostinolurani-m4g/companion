import type { Map as MaplibreMap } from "maplibre-gl";
import { pickStyleFont } from "@/lib/map/topo-style";
import { EMPTY_FC } from "./constants";

/** Dati outdoor (rifugi, sorgenti, segnaletica, tracce): discreti a zoom basso, etichettati da vicino. */
export function addOutdoorFeatureLayers(map: MaplibreMap): void {
  if (map.getSource("v2-outdoor")) return;

  map.addSource("v2-outdoor", { type: "geojson", data: EMPTY_FC });

  map.addLayer({
    id: "v2-outdoor-lines",
    type: "line",
    source: "v2-outdoor",
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": "#b7a98f",
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 2.4, 17, 3.5],
      "line-opacity": 0.8,
      "line-dasharray": ["case", ["get", "dashed"], ["literal", [2, 2]], ["literal", [1, 0]]],
    },
  });

  map.addLayer({
    id: "v2-outdoor-points",
    type: "circle",
    source: "v2-outdoor",
    filter: ["==", ["geometry-type"], "Point"],
    // Discreti di default; risaltano quelli dei gruppi selezionati (proprietà `hl`).
    paint: {
      // Lo zoom deve stare nell'interpolazione esterna (MapLibre non lo accetta dentro "case").
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        9, ["case", ["boolean", ["get", "hl"], false], 3.5, 1.5],
        12, ["case", ["boolean", ["get", "hl"], false], 5, 2.2],
        14, ["case", ["boolean", ["get", "hl"], false], 6.5, 3],
        17, ["case", ["boolean", ["get", "hl"], false], 8, 4],
      ],
      // Pochi toni: rifugi petrolio, acqua azzurro, rischi rosa, resto grigio.
      "circle-color": ["match", ["get", "grp"], "shelter", "#3f9b90", "water", "#3b8fd9", "hazard", "#d06a6a", "#8a949b"],
      "circle-opacity": ["case", ["boolean", ["get", "hl"], false], 1, 0.4],
      "circle-stroke-width": ["case", ["boolean", ["get", "hl"], false], 1.5, 0],
      "circle-stroke-color": "#ffffff",
    },
  });

  map.addLayer({
    id: "v2-outdoor-label",
    type: "symbol",
    source: "v2-outdoor",
    minzoom: 14,
    // Nomi solo dei punti evidenziati e dei rifugi (gli altri restano pallini discreti).
    filter: [
      "all",
      ["==", ["geometry-type"], "Point"],
      ["!=", ["get", "name"], ""],
      ["any", ["boolean", ["get", "hl"], false], ["==", ["get", "grp"], "shelter"]],
    ],
    layout: {
      "text-field": [
        "case",
        ["to-boolean", ["get", "ele"]],
        ["concat", ["get", "name"], "\n", ["to-string", ["round", ["get", "ele"]]], " m"],
        ["get", "name"],
      ],
      "text-font": pickStyleFont(map),
      "text-size": 11,
      "text-offset": [0, 0.9],
      "text-anchor": "top",
      "text-max-width": 8,
      "text-optional": true,
    },
    paint: {
      "text-color": "#334155",
      "text-halo-color": "rgba(255,255,255,0.92)",
      "text-halo-width": 1.4,
    },
  });

  map.addLayer({
    id: "v2-outdoor-hit",
    type: "circle",
    source: "v2-outdoor",
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 12, "circle-opacity": 0 },
  });
}
