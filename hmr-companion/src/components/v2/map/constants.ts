import type maplibregl from "maplibre-gl";
import { AVALANCHE_LEGEND } from "@/lib/ski-overlays";

export const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export { OPEN_DEM_SOURCE_ID } from "@/lib/map/topo-style";
export const TERRAIN_3D_PITCH = 55;
export const TERRAIN_EXAGGERATION = 1.35;

export const AVALANCHE_FILL_COLOR: maplibregl.ExpressionSpecification = [
  "case",
  ["==", ["get", "danger"], 1],
  AVALANCHE_LEGEND[0].color,
  ["==", ["get", "danger"], 2],
  AVALANCHE_LEGEND[1].color,
  ["==", ["get", "danger"], 3],
  AVALANCHE_LEGEND[2].color,
  ["==", ["get", "danger"], 4],
  AVALANCHE_LEGEND[3].color,
  ["==", ["get", "danger"], 5],
  AVALANCHE_LEGEND[4].color,
  "#64748b",
];

export const WAYPOINT_RADIUS = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  4,
  11,
  6,
  13,
  8,
  15,
  10,
  17,
  13,
  19,
  16,
] as maplibregl.ExpressionSpecification;

export const WAYPOINT_HALO_RADIUS = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  7,
  11,
  10,
  13,
  13,
  15,
  16,
  17,
  20,
  19,
  24,
] as maplibregl.ExpressionSpecification;

export const WAYPOINT_STROKE_WIDTH = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  1.5,
  13,
  2.5,
  17,
  3,
  19,
  3.5,
] as maplibregl.ExpressionSpecification;

/**
 * Larghezze percorso: esponenziali (crescono con la scala della mappa) e sempre ≥ 2× i sentieri
 * del basemap, così la traccia non si confonde con "un'altra strada". Contorno = linea + ~3 px.
 */
export const ROUTE_LINE_WIDTH = [
  "interpolate",
  ["exponential", 1.4],
  ["zoom"],
  8,
  2.6,
  12,
  4.2,
  15,
  6,
  18,
  8,
] as maplibregl.ExpressionSpecification;

export const ROUTE_CASING_WIDTH = [
  "interpolate",
  ["exponential", 1.4],
  ["zoom"],
  8,
  5,
  12,
  7.2,
  15,
  9.4,
  18,
  12,
] as maplibregl.ExpressionSpecification;
