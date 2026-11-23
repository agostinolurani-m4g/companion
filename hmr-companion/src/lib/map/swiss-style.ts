import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";

/**
 * Stile cartografico "tipo carta nazionale svizzera" su dati OpenMapTiles (OpenFreeMap).
 * Carta avorio, boschi verde tenue, ghiacciai bianco-azzurri, strade con gerarchia
 * rosso → arancio → giallo → bianco, sentieri neri tratteggiati, vette con triangolo e quota.
 * Rilievo (ombreggiatura + isoipse) viene aggiunto a runtime da topo-style / contourLayer.
 */

const SRC = "omt";
const FONT_REG = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];
const FONT_IT = ["Noto Sans Italic"];

type Palette = {
  paper: string;
  forest: string;
  forestEdge: string;
  meadow: string;
  rock: string;
  scree: string;
  glacier: string;
  glacierEdge: string;
  water: string;
  waterLine: string;
  waterLabel: string;
  settlement: string;
  building: string;
  motorway: string;
  motorwayCase: string;
  primary: string;
  primaryCase: string;
  secondary: string;
  secondaryCase: string;
  minor: string;
  minorCase: string;
  track: string;
  path: string;
  cycleway: string;
  rail: string;
  border: string;
  label: string;
  labelHalo: string;
  peak: string;
  peakIcon: string;
  hutIcon: string;
};

/**
 * Chiara, carta svizzera: avorio caldo, boschi verdi leggibili (il colore che rende viva una topo),
 * roccia e detriti beige. Paper/forest sono anche i campioni di contrasto in route-colors.ts.
 */
export const SWISS: Palette = {
  paper: "#f6f3ea",
  forest: "#d4e3c2",
  forestEdge: "#bcd2a6",
  meadow: "#edf0dc",
  rock: "#e9e3d8",
  scree: "#efe9dc",
  glacier: "#f2f6f9",
  glacierEdge: "#a9c3d6",
  water: "#c9dde8",
  waterLine: "#8fb3c9",
  waterLabel: "#5d8aa6",
  settlement: "#e9e6e1",
  building: "#b9b4ae",
  motorway: "#d9b1ad",
  motorwayCase: "#b5918d",
  primary: "#e3cdb2",
  primaryCase: "#b9a389",
  secondary: "#ece2c6",
  secondaryCase: "#bfb498",
  minor: "#ffffff",
  minorCase: "#c4c0b9",
  track: "#a58f74",
  path: "#5d5a56",
  cycleway: "#9a8fc9",
  rail: "#8a8784",
  border: "#a99bd9",
  label: "#3b3936",
  labelHalo: "rgba(244,243,239,0.92)",
  peak: "#57504a",
  peakIcon: "v2-peak",
  hutIcon: "v2-hut",
};

/**
 * Scura "notte svizzera", coordinata con l'interfaccia (petrolio/viola smorzati):
 * boschi verde profondo ben distinti (altrimenti tutto è un unico grigio), roccia grigio-blu.
 */
export const SWISS_DARK: Palette = {
  paper: "#1b2024",
  forest: "#22322a",
  forestEdge: "#2a3d33",
  meadow: "#1f2623",
  rock: "#262a2e",
  scree: "#22262a",
  glacier: "#283038",
  glacierEdge: "#4f6b80",
  water: "#1f2f3a",
  waterLine: "#3f5f73",
  waterLabel: "#7fa3b8",
  settlement: "#22272b",
  building: "#30363b",
  motorway: "#6e5552",
  motorwayCase: "#4b3a38",
  primary: "#5f5446",
  primaryCase: "#443c32",
  secondary: "#4f4b40",
  secondaryCase: "#3a372f",
  minor: "#3a4046",
  minorCase: "#2a2f34",
  track: "#7c6d5b",
  path: "#9aa2a8",
  cycleway: "#8e83bd",
  rail: "#5a6066",
  border: "#8e83bd",
  label: "#cfd4d6",
  labelHalo: "rgba(20,23,26,0.9)",
  peak: "#c3c9cc",
  peakIcon: "v2-peak-light",
  hutIcon: "v2-hut",
};

/**
 * Trame "disegnate" (tratteggio rupi, puntinato detriti, segni d'albero, grana della carta).
 * Le immagini sono generate su canvas da src/components/v2/map/mapImages.ts su `styleimagemissing`.
 */
export const PATTERN_IDS = {
  light: { rock: "v2-pat-rock-light", scree: "v2-pat-scree-light", forest: "v2-pat-forest-light", paper: "v2-pat-paper-light" },
  dark: { rock: "v2-pat-rock-dark", scree: "v2-pat-scree-dark", forest: "v2-pat-forest-dark", paper: "v2-pat-paper-dark" },
} as const;

const name: ExpressionSpecification = ["coalesce", ["get", "name:it"], ["get", "name:latin"], ["get", "name"]];
const cls = (...c: string[]): ExpressionSpecification => ["match", ["get", "class"], c, true, false];
const notTunnel: ExpressionSpecification = ["!=", ["get", "brunnel"], "tunnel"];
const z = (...stops: number[]): ExpressionSpecification =>
  ["interpolate", ["exponential", 1.5], ["zoom"], ...stops] as unknown as ExpressionSpecification;

function road(id: string, classes: string[], fill: string, casing: string, w: number[], minzoom = 5): LayerSpecification[] {
  const filter: ExpressionSpecification = ["all", ["==", ["geometry-type"], "LineString"], cls(...classes), notTunnel];
  return [
    {
      id: `${id}-casing`,
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom,
      filter,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": casing, "line-width": z(...w.map((v, i) => (i % 2 === 0 ? v : v + 1.4))) },
    },
    {
      id: `${id}`,
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom,
      filter,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": fill, "line-width": z(...w) },
    },
  ];
}

export function buildSwissTopoStyle(theme: "light" | "dark" = "light"): StyleSpecification {
  const P = theme === "dark" ? SWISS_DARK : SWISS;
  const PAT = PATTERN_IDS[theme];
  const layers: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": P.paper } },
    // Grana della carta (effetto stampa): fill-pattern su un poligono mondo. Non `background-pattern`,
    // che non emette `styleimagemissing` e perde l'immagine a ogni cambio stile.
    { id: "paper-grain", type: "fill", source: "paper", paint: { "fill-pattern": PAT.paper } },

    /* ── Suolo ── */
    {
      id: "landuse-settlement",
      type: "fill",
      source: SRC,
      "source-layer": "landuse",
      filter: cls("residential", "suburb", "neighbourhood", "commercial", "industrial", "retail"),
      paint: { "fill-color": P.settlement },
    },
    {
      id: "landcover-meadow",
      type: "fill",
      source: SRC,
      "source-layer": "landcover",
      filter: cls("grass"),
      paint: { "fill-color": P.meadow, "fill-opacity": 0.7 },
    },
    {
      id: "park",
      type: "fill",
      source: SRC,
      "source-layer": "park",
      paint: { "fill-color": P.forest, "fill-opacity": 0.35 },
    },
    {
      id: "landcover-wood",
      type: "fill",
      source: SRC,
      "source-layer": "landcover",
      filter: cls("wood"),
      paint: {
        "fill-color": P.forest,
        "fill-outline-color": P.forestEdge,
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 12, 1],
      },
    },
    {
      id: "landcover-rock",
      type: "fill",
      source: SRC,
      "source-layer": "landcover",
      filter: cls("rock"),
      paint: { "fill-color": P.rock },
    },
    {
      id: "landcover-scree",
      type: "fill",
      source: SRC,
      "source-layer": "landcover",
      filter: cls("sand"),
      paint: { "fill-color": P.scree },
    },
    /* Trame "disegnate" sopra le campiture: compaiono con lo zoom, così da lontano resta pulito. */
    {
      id: "landcover-rock-hatch",
      type: "fill",
      source: SRC,
      "source-layer": "landcover",
      minzoom: 11,
      filter: cls("rock"),
      paint: { "fill-pattern": PAT.rock, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.35, 13, 1] },
    },
    {
      id: "landcover-scree-stipple",
      type: "fill",
      source: SRC,
      "source-layer": "landcover",
      minzoom: 12,
      filter: cls("sand"),
      paint: { "fill-pattern": PAT.scree, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.4, 14, 1] },
    },
    {
      id: "landcover-wood-trees",
      type: "fill",
      source: SRC,
      "source-layer": "landcover",
      minzoom: 13,
      filter: cls("wood"),
      paint: { "fill-pattern": PAT.forest, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.3, 15, 1] },
    },
    {
      id: "landcover-wetland",
      type: "fill",
      source: SRC,
      "source-layer": "landcover",
      filter: cls("wetland"),
      paint: { "fill-color": P.meadow },
    },
    {
      id: "landcover-glacier",
      type: "fill",
      source: SRC,
      "source-layer": "landcover",
      filter: cls("ice"),
      paint: { "fill-color": P.glacier },
    },
    {
      id: "landcover-glacier-edge",
      type: "line",
      source: SRC,
      "source-layer": "landcover",
      minzoom: 10,
      filter: cls("ice"),
      paint: { "line-color": P.glacierEdge, "line-width": 0.8, "line-dasharray": [3, 1.5] },
    },

    /* ── Acque ── */
    {
      id: "waterway",
      type: "line",
      source: SRC,
      "source-layer": "waterway",
      filter: notTunnel,
      layout: { "line-cap": "round" },
      paint: {
        "line-color": P.waterLine,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          ["match", ["get", "class"], "river", 1, 0.3],
          14,
          ["match", ["get", "class"], "river", 3, "canal", 2, 1],
          18,
          ["match", ["get", "class"], "river", 7, 2.5],
        ],
      },
    },
    {
      id: "water",
      type: "fill",
      source: SRC,
      "source-layer": "water",
      paint: { "fill-color": P.water },
    },
    {
      id: "water-edge",
      type: "line",
      source: SRC,
      "source-layer": "water",
      minzoom: 11,
      paint: { "line-color": P.waterLine, "line-width": 0.6, "line-opacity": 0.7 },
    },

    /* ── Edifici ── */
    {
      id: "building",
      type: "fill",
      source: SRC,
      "source-layer": "building",
      minzoom: 13,
      paint: { "fill-color": P.building, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 15, 0.9] },
    },

    /* ── Confini ── */
    {
      id: "boundary-country",
      type: "line",
      source: SRC,
      "source-layer": "boundary",
      filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": P.border, "line-width": z(4, 1, 12, 2.5), "line-dasharray": [4, 1.5, 1, 1.5], "line-opacity": 0.75 },
    },
    {
      id: "boundary-region",
      type: "line",
      source: SRC,
      "source-layer": "boundary",
      minzoom: 7,
      filter: ["==", ["get", "admin_level"], 4],
      paint: { "line-color": P.border, "line-width": 0.8, "line-dasharray": [3, 2], "line-opacity": 0.45 },
    },

    /* ── Rete viaria ── */
    {
      id: "tunnel",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom: 12,
      filter: ["all", ["==", ["get", "brunnel"], "tunnel"], cls("motorway", "trunk", "primary", "secondary", "tertiary", "minor")],
      paint: { "line-color": P.minorCase, "line-width": 1.2, "line-dasharray": [2, 2], "line-opacity": 0.6 },
    },
    /*
     * Sentieri. OpenMapTiles non espone `sac_scale` (le difficoltà le mostra il nostro overlay
     * sentieri, src/lib/outdoor/trail-style.ts): qui la gerarchia segue `subclass`/`surface`,
     * come la carta svizzera: sentiero escursionistico tratteggio nero marcato, percorso pedonale
     * urbano fine e chiaro, scalinate a puntini.
     */
    {
      id: "path",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom: 12,
      filter: [
        "all",
        cls("path"),
        ["match", ["get", "subclass"], ["cycleway", "footway", "pedestrian", "steps", "corridor", "platform"], false, true],
        notTunnel,
      ],
      paint: {
        "line-color": P.path,
        "line-width": z(12, 0.7, 14, 1.1, 17, 1.8),
        "line-dasharray": [3, 1.6],
        "line-opacity": ["match", ["get", "surface"], "paved", 0.6, 0.9],
      },
    },
    {
      id: "path-footway",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom: 14,
      filter: ["all", cls("path"), ["match", ["get", "subclass"], ["footway", "pedestrian"], true, false], notTunnel],
      paint: {
        "line-color": P.path,
        "line-width": z(14, 0.5, 17, 1.2),
        "line-dasharray": [2, 1.2],
        "line-opacity": 0.5,
      },
    },
    {
      id: "path-steps",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom: 15,
      filter: ["all", cls("path"), ["==", ["get", "subclass"], "steps"], notTunnel],
      layout: { "line-cap": "round" },
      paint: {
        "line-color": P.path,
        "line-width": z(15, 1.2, 18, 2.4),
        "line-dasharray": [0.1, 1.6],
        "line-opacity": 0.8,
      },
    },
    {
      id: "cycleway",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom: 12,
      filter: ["all", cls("path"), ["==", ["get", "subclass"], "cycleway"], notTunnel],
      paint: { "line-color": P.cycleway, "line-width": z(12, 0.8, 16, 2), "line-dasharray": [4, 1.5] },
    },
    {
      id: "track",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom: 11,
      filter: ["all", cls("track"), notTunnel],
      paint: { "line-color": P.track, "line-width": z(11, 0.7, 16, 1.8), "line-dasharray": [5, 1.5] },
    },
    ...road("road-minor", ["minor", "service"], P.minor, P.minorCase, [11, 0.6, 14, 2.2, 18, 9], 11),
    ...road("road-secondary", ["secondary", "tertiary"], P.secondary, P.secondaryCase, [8, 0.8, 12, 2, 18, 13], 8),
    ...road("road-primary", ["primary", "trunk"], P.primary, P.primaryCase, [6, 0.8, 12, 2.6, 18, 16], 6),
    ...road("road-motorway", ["motorway"], P.motorway, P.motorwayCase, [5, 0.8, 12, 3, 18, 18], 5),
    {
      id: "rail",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom: 9,
      filter: ["all", cls("rail", "transit"), notTunnel],
      paint: { "line-color": P.rail, "line-width": z(9, 0.8, 16, 2.2) },
    },
    {
      id: "rail-hatch",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom: 13,
      filter: ["all", cls("rail"), notTunnel],
      paint: { "line-color": P.paper, "line-width": z(13, 0.8, 16, 1.4), "line-dasharray": [0.2, 4] },
    },
    {
      id: "aerialway",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom: 12,
      filter: cls("aerialway"),
      paint: { "line-color": P.path, "line-width": 0.9 },
    },

    /* ── Etichette ── */
    {
      id: "water-name",
      type: "symbol",
      source: SRC,
      "source-layer": "water_name",
      layout: { "text-field": name, "text-font": FONT_IT, "text-size": 12, "text-max-width": 7 },
      paint: { "text-color": P.waterLabel, "text-halo-color": P.labelHalo, "text-halo-width": 1.2 },
    },
    {
      id: "waterway-name",
      type: "symbol",
      source: SRC,
      "source-layer": "waterway",
      minzoom: 13,
      filter: cls("river", "stream"),
      layout: { "symbol-placement": "line", "text-field": name, "text-font": FONT_IT, "text-size": 11 },
      paint: { "text-color": P.waterLabel, "text-halo-color": P.labelHalo, "text-halo-width": 1.2 },
    },
    {
      id: "road-name",
      type: "symbol",
      source: SRC,
      "source-layer": "transportation_name",
      minzoom: 14,
      layout: { "symbol-placement": "line", "text-field": name, "text-font": FONT_REG, "text-size": 10.5 },
      paint: { "text-color": P.label, "text-halo-color": P.labelHalo, "text-halo-width": 1.2 },
    },
    {
      id: "hut",
      type: "symbol",
      source: SRC,
      "source-layer": "poi",
      minzoom: 12,
      filter: ["match", ["get", "subclass"], ["alpine_hut", "wilderness_hut"], true, false],
      layout: {
        "icon-image": P.hutIcon,
        "icon-size": 1,
        "text-field": name,
        "text-font": FONT_BOLD,
        "text-size": 10.5,
        "text-offset": [0, 0.9],
        "text-anchor": "top",
        "text-optional": true,
        "text-max-width": 8,
      },
      paint: { "text-color": P.label, "text-halo-color": P.labelHalo, "text-halo-width": 1.2 },
    },
    {
      id: "peak",
      type: "symbol",
      source: SRC,
      "source-layer": "mountain_peak",
      minzoom: 9,
      filter: ["match", ["get", "class"], ["peak", "volcano"], true, false],
      layout: {
        "icon-image": P.peakIcon,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.7, 14, 1],
        "text-field": [
          "format",
          name,
          { "font-scale": 1 },
          "\n",
          {},
          ["concat", ["to-string", ["get", "ele"]], ""],
          { "font-scale": 0.85, "text-font": ["literal", FONT_REG] },
        ],
        "text-font": FONT_BOLD,
        "text-size": ["interpolate", ["linear"], ["zoom"], 9, 9.5, 14, 11.5],
        "text-offset": [0, 0.7],
        "text-anchor": "top",
        "text-optional": true,
        "text-max-width": 8,
      },
      paint: { "text-color": P.peak, "text-halo-color": P.labelHalo, "text-halo-width": 1.3 },
    },
    {
      id: "saddle",
      type: "symbol",
      source: SRC,
      "source-layer": "mountain_peak",
      minzoom: 12,
      filter: ["==", ["get", "class"], "saddle"],
      layout: {
        "text-field": ["concat", name, "\n", ["to-string", ["get", "ele"]]],
        "text-font": FONT_IT,
        "text-size": 10,
      },
      paint: { "text-color": P.peak, "text-halo-color": P.labelHalo, "text-halo-width": 1.2 },
    },
    {
      id: "place-minor",
      type: "symbol",
      source: SRC,
      "source-layer": "place",
      minzoom: 12,
      filter: cls("hamlet", "isolated_dwelling", "locality", "neighbourhood"),
      layout: { "text-field": name, "text-font": FONT_REG, "text-size": 10.5, "text-max-width": 8 },
      paint: { "text-color": P.label, "text-halo-color": P.labelHalo, "text-halo-width": 1.2 },
    },
    {
      id: "place-village",
      type: "symbol",
      source: SRC,
      "source-layer": "place",
      minzoom: 10,
      filter: cls("village", "suburb"),
      layout: { "text-field": name, "text-font": FONT_REG, "text-size": z(10, 11, 15, 14), "text-max-width": 8 },
      paint: { "text-color": P.label, "text-halo-color": P.labelHalo, "text-halo-width": 1.4 },
    },
    {
      id: "place-town",
      type: "symbol",
      source: SRC,
      "source-layer": "place",
      minzoom: 7,
      filter: cls("town"),
      layout: { "text-field": name, "text-font": FONT_BOLD, "text-size": z(7, 11, 14, 16), "text-max-width": 8 },
      paint: { "text-color": P.label, "text-halo-color": P.labelHalo, "text-halo-width": 1.5 },
    },
    {
      id: "place-city",
      type: "symbol",
      source: SRC,
      "source-layer": "place",
      filter: cls("city"),
      layout: { "text-field": name, "text-font": FONT_BOLD, "text-size": z(5, 12, 12, 20), "text-max-width": 8 },
      paint: { "text-color": P.label, "text-halo-color": P.labelHalo, "text-halo-width": 1.6 },
    },
    {
      id: "place-country",
      type: "symbol",
      source: SRC,
      "source-layer": "place",
      maxzoom: 8,
      filter: cls("country"),
      layout: {
        "text-field": name,
        "text-font": FONT_BOLD,
        "text-size": 13,
        "text-transform": "uppercase",
        "text-letter-spacing": 0.15,
      },
      paint: { "text-color": P.border, "text-halo-color": P.labelHalo, "text-halo-width": 1.5 },
    },
  ];

  return {
    version: 8,
    name: theme === "dark" ? "HMR Topo notte" : "HMR Topo",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      [SRC]: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "© OpenStreetMap · © OpenFreeMap" },
      paper: {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [[[-180, -85.05], [180, -85.05], [180, 85.05], [-180, 85.05], [-180, -85.05]]] },
        },
      },
    },
    layers,
  };
}

/** Bbox approssimativo coperto da swisstopo (CH + aree di confine). */
export const SWISSTOPO_BOUNDS: [number, number, number, number] = [5.8, 45.75, 10.6, 47.9];

/**
 * Versione notturna di una carta raster: inverte la luminosità e ruota la tinta di 180°
 * (così boschi restano verdi e acque blu), poi desatura per toni pastello.
 */
export const RASTER_DARK_PAINT = {
  "raster-brightness-min": 0.9,
  "raster-brightness-max": 0.07,
  "raster-hue-rotate": 180,
  "raster-saturation": -0.35,
  "raster-contrast": -0.08,
} as const;

/** Carta nazionale swisstopo (raster) sopra lo stile topo: fuori dalla Svizzera resta il nostro. */
export function buildSwisstopoStyle(theme: "light" | "dark" = "light"): StyleSpecification {
  const base = buildSwissTopoStyle(theme);
  const firstSymbol = base.layers.findIndex((l) => l.type === "symbol");
  const raster: LayerSpecification = {
    id: "swisstopo-pixelkarte",
    type: "raster",
    source: "swisstopo",
    paint: { "raster-fade-duration": 150, ...(theme === "dark" ? RASTER_DARK_PAINT : {}) },
  };
  return {
    ...base,
    name: "swisstopo",
    sources: {
      ...base.sources,
      swisstopo: {
        type: "raster",
        tiles: ["https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg"],
        tileSize: 256,
        minzoom: 7,
        maxzoom: 18,
        bounds: SWISSTOPO_BOUNDS,
        attribution: "© swisstopo",
      },
    },
    // La carta svizzera ha già testi: niente etichette vettoriali sopra.
    layers: [...base.layers.slice(0, firstSymbol), raster],
  };
}

/**
 * Ortofoto recenti: SWISSIMAGE (10–25 cm, aggiornata a ciclo triennale) in Svizzera,
 * Esri World Imagery altrove, con strade ed etichette leggere sopra.
 */
export function buildOrthophotoStyle(): StyleSpecification {
  const base = buildSwissTopoStyle();
  const halo = "rgba(0,0,0,0.65)";
  const labels = base.layers
    .filter((l) => l.type === "symbol")
    .map((l) => {
      const ll = l as LayerSpecification & { paint?: Record<string, unknown> };
      return { ...ll, paint: { ...(ll.paint ?? {}), "text-color": "#ffffff", "text-halo-color": halo, "text-halo-width": 1.4 } } as LayerSpecification;
    });
  return {
    version: 8,
    name: "Ortofoto",
    glyphs: base.glyphs,
    sources: {
      ...base.sources,
      esri: {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© Esri, Maxar, Earthstar Geographics",
      },
      swissimage: {
        type: "raster",
        tiles: ["https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg"],
        tileSize: 256,
        minzoom: 8,
        maxzoom: 20,
        bounds: [5.95, 45.82, 10.49, 47.81],
        attribution: "© swisstopo SWISSIMAGE",
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#1f2a1f" } },
      { id: "esri", type: "raster", source: "esri" },
      { id: "swissimage", type: "raster", source: "swissimage" },
      {
        id: "ortho-roads",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        minzoom: 10,
        filter: cls("motorway", "trunk", "primary", "secondary", "tertiary"),
        paint: { "line-color": "rgba(255,240,200,0.55)", "line-width": z(10, 0.6, 16, 2.5) },
      },
      {
        id: "ortho-paths",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        minzoom: 13,
        filter: cls("path", "track"),
        paint: { "line-color": "rgba(255,255,255,0.75)", "line-width": 1, "line-dasharray": [3, 1.6] },
      },
      ...labels,
    ],
  };
}
