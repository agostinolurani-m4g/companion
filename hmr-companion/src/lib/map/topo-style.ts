import type { LayerSpecification, Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import type { UserRouteActivity } from "@/lib/sports";
import { isWinterSport } from "@/lib/sports";
import { buildOrthophotoStyle, buildSwissTopoStyle, buildSwisstopoStyle, RASTER_DARK_PAINT } from "@/lib/map/swiss-style";

export const OPEN_FREE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
export const OPEN_DEM_SOURCE_ID = "open-terrain-dem";
export const OPEN_DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const OFM_GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() || undefined;

/* ───────────────────────────── Base map catalog ───────────────────────────── */

export type BaseStyleId = "topo" | "swisstopo" | "satellite" | "outdoor" | "winter" | "opentopo" | "light";

/** Aspetto della mappa: chiaro o scuro (dove lo stile lo supporta). */
export type MapMode = "light" | "dark";

export type BaseMapDef = {
  id: BaseStyleId;
  label: string;
  /** Breve descrizione per il selettore livelli. */
  hint: string;
  /** Tile raster di anteprima (Valchiavenna/Bregaglia, z12); null = campione di colore. */
  thumb: string | null;
  /** Colore di fallback per l'anteprima. */
  swatch: string;
  /** Lo stile è sempre scuro (es. ortofoto): curve/etichette chiare. */
  dark: boolean;
  /** Esiste una variante scura (modalità notte). */
  supportsDark: boolean;
  /** Lo stile ha già rilievo proprio: niente ombreggiatura/tinta aggiunte. */
  ownRelief: boolean;
  requiresKey: boolean;
};

const THUMB = { z: 12, x: 2155, y: 1451 };

function rasterStyle(
  id: string,
  tiles: string[],
  attribution: string,
  maxzoom: number,
  tileSize = 256,
): StyleSpecification {
  return {
    version: 8,
    glyphs: OFM_GLYPHS,
    sources: { [id]: { type: "raster", tiles, tileSize, attribution, maxzoom } },
    layers: [{ id: `${id}-base`, type: "raster", source: id }],
  };
}

/** Raster OSM fallback when remote style fetch fails. */
export const OSM_RASTER_STYLE: StyleSpecification = rasterStyle(
  "osm",
  ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
  "© OpenStreetMap",
  19,
);

const OPENTOPO_STYLE = rasterStyle(
  "opentopo",
  [
    "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
    "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
  ],
  "© OpenTopoMap (CC-BY-SA) · © OpenStreetMap",
  17,
);

export const BASE_MAPS: readonly BaseMapDef[] = [
  {
    id: "topo",
    supportsDark: true,
    swatch: "#f7f5ef",
    label: "Topo",
    hint: "Carta topografica con rilievo e isoipse",
    thumb: `https://tile.opentopomap.org/${THUMB.z}/${THUMB.x}/${THUMB.y}.png`,
    dark: false,
    ownRelief: false,
    requiresKey: false,
  },
  {
    id: "swisstopo",
    supportsDark: true,
    swatch: "#f3efe4",
    label: "Swisstopo",
    hint: "Carta nazionale svizzera (CH e confini)",
    thumb: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/${THUMB.z}/${THUMB.x}/${THUMB.y}.jpeg`,
    dark: false,
    ownRelief: true,
    requiresKey: false,
  },
  {
    id: "satellite",
    supportsDark: false,
    swatch: "#3d4a32",
    label: "Ortofoto",
    hint: "Foto aeree recenti (SWISSIMAGE in CH)",
    thumb: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/${THUMB.z}/${THUMB.x}/${THUMB.y}.jpeg`,
    dark: true,
    ownRelief: true,
    requiresKey: false,
  },
  {
    id: "outdoor",
    supportsDark: true,
    swatch: "#e6efd8",
    label: "Outdoor",
    hint: "MapTiler Outdoor",
    thumb: `https://api.maptiler.com/maps/outdoor-v2/256/${THUMB.z}/${THUMB.x}/${THUMB.y}.png?key=${MAPTILER_KEY ?? ""}`,
    dark: false,
    ownRelief: true,
    requiresKey: true,
  },
  {
    id: "winter",
    supportsDark: true,
    swatch: "#e8eef5",
    label: "Inverno",
    hint: "Piste e impianti",
    thumb: `https://api.maptiler.com/maps/winter-v2/256/${THUMB.z}/${THUMB.x}/${THUMB.y}.png?key=${MAPTILER_KEY ?? ""}`,
    dark: false,
    ownRelief: true,
    requiresKey: true,
  },
  {
    id: "opentopo",
    supportsDark: true,
    swatch: "#cfdcae",
    label: "OpenTopo",
    hint: "Cartografia OpenTopoMap",
    thumb: `https://tile.opentopomap.org/${THUMB.z}/${THUMB.x}/${THUMB.y}.png`,
    dark: false,
    ownRelief: true,
    requiresKey: false,
  },
  {
    id: "light",
    supportsDark: true,
    swatch: "#f2f2ef",
    label: "Essenziale",
    hint: "Minimale, dati in risalto",
    thumb: MAPTILER_KEY ? `https://api.maptiler.com/maps/dataviz/256/${THUMB.z}/${THUMB.x}/${THUMB.y}.png?key=${MAPTILER_KEY}` : null,
    dark: false,
    ownRelief: false,
    requiresKey: false,
  },
];

export const BASE_STYLE_LABELS: Record<BaseStyleId, string> = Object.fromEntries(
  BASE_MAPS.map((b) => [b.id, b.label]),
) as Record<BaseStyleId, string>;

export function baseMapDef(id: BaseStyleId): BaseMapDef {
  return BASE_MAPS.find((b) => b.id === id) ?? BASE_MAPS[0];
}

export function isBaseStyleId(raw: unknown): raw is BaseStyleId {
  return typeof raw === "string" && BASE_MAPS.some((b) => b.id === raw);
}

export function hasMaptilerFallback(): boolean {
  return Boolean(MAPTILER_KEY);
}

export function listBaseStyleOptions(): BaseStyleId[] {
  return BASE_MAPS.filter((b) => !b.requiresKey || MAPTILER_KEY).map((b) => b.id);
}

export function listBaseMaps(): BaseMapDef[] {
  return BASE_MAPS.filter((b) => !b.requiresKey || MAPTILER_KEY);
}

export function defaultBaseStyleUrl(_activity?: UserRouteActivity): string {
  return OPEN_FREE_MAP_STYLE;
}

export function resolveInitialStyleUrl(activity?: UserRouteActivity): string {
  return defaultBaseStyleUrl(activity);
}

/** Base consigliata per lo sport (inverno → mappa invernale se disponibile). */
export function defaultBaseForSport(activity?: UserRouteActivity): BaseStyleId {
  if (activity && isWinterSport(activity) && MAPTILER_KEY) return "winter";
  return "topo";
}

/** La mappa risultante è scura? (ortofoto sempre; altre se in modalità scura). */
export function isBaseDark(id: BaseStyleId, mode: MapMode): boolean {
  const def = baseMapDef(id);
  return def.dark || (mode === "dark" && def.supportsDark);
}

function withRasterDark(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((l) =>
      l.type === "raster" ? { ...l, paint: { ...(l.paint ?? {}), ...RASTER_DARK_PAINT } } : l,
    ) as StyleSpecification["layers"],
  };
}

export function styleForBaseId(
  id: BaseStyleId,
  _activity?: UserRouteActivity,
  mode: MapMode = "light",
): string | StyleSpecification {
  const dark = mode === "dark";
  switch (id) {
    case "topo":
      return buildSwissTopoStyle(mode);
    case "swisstopo":
      return buildSwisstopoStyle(mode);
    case "outdoor":
      return MAPTILER_KEY
        ? `https://api.maptiler.com/maps/${dark ? "outdoor-v2-dark" : "outdoor-v2"}/style.json?key=${MAPTILER_KEY}`
        : buildSwissTopoStyle(mode);
    case "winter":
      return MAPTILER_KEY
        ? `https://api.maptiler.com/maps/${dark ? "winter-v2-dark" : "winter-v2"}/style.json?key=${MAPTILER_KEY}`
        : buildSwissTopoStyle(mode);
    case "satellite":
      return buildOrthophotoStyle();
    case "opentopo":
      return dark ? withRasterDark(OPENTOPO_STYLE) : OPENTOPO_STYLE;
    case "light":
      return dark ? "https://tiles.openfreemap.org/styles/dark" : "https://tiles.openfreemap.org/styles/positron";
  }
}

/** @deprecated usa styleForBaseId (può restituire anche uno stile inline). */
export function styleUrlForBaseId(id: BaseStyleId, activity?: UserRouteActivity): string {
  const s = styleForBaseId(id, activity);
  return typeof s === "string" ? s : OPEN_FREE_MAP_STYLE;
}

export function isWinterTopo(activity?: UserRouteActivity): boolean {
  return activity ? isWinterSport(activity) : false;
}

/* ───────────────────────────── Relief helpers ───────────────────────────── */

export function ensureDemSource(map: MaplibreMap): void {
  if (map.getSource(OPEN_DEM_SOURCE_ID)) return;
  map.addSource(OPEN_DEM_SOURCE_ID, {
    type: "raster-dem",
    tiles: [OPEN_DEM_TILES],
    tileSize: 256,
    encoding: "terrarium",
    maxzoom: 15,
    attribution: "© Mapzen / AWS Terrain Tiles",
  });
}

type LayerLike = { id: string; type: string };

/** Primo layer "lineare" del basemap (acqua/strade): rilievo va sotto, landcover sopra. */
export function reliefInsertBefore(map: MaplibreMap): string | undefined {
  const layers = (map.getStyle().layers ?? []) as LayerLike[];
  const ours = (id: string) => id.startsWith("v2-") || id.startsWith("topo-") || id.startsWith("overlay-") || id.startsWith("ski-") || id.startsWith("contour");
  const hit = layers.find(
    (l) =>
      !ours(l.id) &&
      (/^(waterway|water$|water_|tunnel|road|highway|bridge|building|aeroway|transportation)/.test(l.id) ||
        l.type === "symbol"),
  );
  return hit?.id;
}

/** Primo layer simbolico (etichette) del basemap. */
export function firstSymbolLayer(map: MaplibreMap): string | undefined {
  const layers = (map.getStyle().layers ?? []) as LayerLike[];
  return layers.find((l) => l.type === "symbol" && !l.id.startsWith("v2-") && !l.id.startsWith("contour"))?.id;
}

/** Primo layer di riempimento dopo lo sfondo/raster di base (per la tinta altimetrica). */
function firstFillLayer(map: MaplibreMap): string | undefined {
  const layers = (map.getStyle().layers ?? []) as LayerLike[];
  return layers.find((l) => l.type === "fill" && !l.id.startsWith("v2-") && !l.id.startsWith("ski-"))?.id;
}

/** Font disponibile nel glyph server dello stile corrente (per etichette nostre). */
export function pickStyleFont(map: MaplibreMap): string[] {
  const layers = (map.getStyle().layers ?? []) as Array<LayerLike & { layout?: Record<string, unknown> }>;
  for (const l of layers) {
    if (l.type !== "symbol" || l.id.startsWith("v2-") || l.id.startsWith("contour")) continue;
    const tf = l.layout?.["text-font"];
    if (Array.isArray(tf) && tf.length > 0 && tf.every((x) => typeof x === "string")) {
      return [tf[0] as string];
    }
  }
  return ["Noto Sans Regular"];
}

export type ReliefOptions = {
  hillshade: boolean;
  /** Tinta ipsometrica leggera (solo su stili senza rilievo proprio). */
  tint: boolean;
  dark: boolean;
  winter: boolean;
};

const HILLSHADE_ID = "topo-hillshade";
const TINT_ID = "topo-color-relief";

/** Ombreggiatura + tinta altimetrica sotto strade e acqua (mai sopra il basemap). */
export function applyRelief(map: MaplibreMap, opts: ReliefOptions): void {
  if (!map.style) return;
  ensureDemSource(map);

  if (opts.hillshade && !map.getLayer(HILLSHADE_ID)) {
    map.addLayer(
      {
        id: HILLSHADE_ID,
        type: "hillshade",
        source: OPEN_DEM_SOURCE_ID,
        paint: {
          "hillshade-method": "multidirectional",
          "hillshade-highlight-color": opts.dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.55)",
          "hillshade-shadow-color": opts.dark ? "rgba(0,0,0,0.55)" : opts.winter ? "rgba(71,85,105,0.55)" : "rgba(43,52,70,0.42)",
          "hillshade-accent-color": opts.dark ? "rgba(0,0,0,0.3)" : "rgba(60,60,70,0.25)",
          "hillshade-exaggeration": opts.dark ? 0.4 : 0.5,
        },
      } as LayerSpecification,
      reliefInsertBefore(map),
    );
  }
  if (map.getLayer(HILLSHADE_ID)) {
    map.setLayoutProperty(HILLSHADE_ID, "visibility", opts.hillshade ? "visible" : "none");
  }

  if (opts.tint && !opts.dark && !map.getLayer(TINT_ID)) {
    map.addLayer(
      {
        id: TINT_ID,
        type: "color-relief",
        source: OPEN_DEM_SOURCE_ID,
        paint: {
          "color-relief-opacity": opts.winter ? 0.35 : 0.42,
          "color-relief-color": opts.winter
            ? ["interpolate", ["linear"], ["elevation"], 0, "#eef2f7", 1200, "#e2e8f0", 2200, "#dbe3ee", 3000, "#f8fafc"]
            : [
                "interpolate",
                ["linear"],
                ["elevation"],
                0,
                "#dfe8cf",
                500,
                "#d3e0bd",
                1000,
                "#e6dcb5",
                1700,
                "#dccaa4",
                2300,
                "#cfc4b8",
                2800,
                "#e9e6e2",
                3400,
                "#ffffff",
              ],
        },
      } as LayerSpecification,
      firstFillLayer(map),
    );
  }
  if (map.getLayer(TINT_ID)) {
    map.setLayoutProperty(TINT_ID, "visibility", opts.tint && !opts.dark ? "visible" : "none");
  }
}

/** Compat: vecchia API (ombreggiatura sempre attiva). */
export function ensureOpenDemOnMap(map: MaplibreMap, winter = false): void {
  ensureDemSource(map);
  if (!map.getLayer(HILLSHADE_ID)) applyRelief(map, { hillshade: true, tint: false, dark: false, winter });
}

export function applyTopoEnhancements(map: MaplibreMap, activity?: UserRouteActivity): void {
  if (!map.isStyleLoaded()) return;
  ensureOpenDemOnMap(map, isWinterTopo(activity));
}

/** Cielo e foschia per la vista 3D. */
export function applySky(map: MaplibreMap, dark: boolean): void {
  try {
    map.setSky(
      dark
        ? {
            "sky-color": "#0b1424",
            "horizon-color": "#1e2b44",
            "fog-color": "#111a2c",
            "sky-horizon-blend": 0.6,
            "horizon-fog-blend": 0.6,
            "fog-ground-blend": 0.75,
            "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 0],
          }
        : {
            "sky-color": "#7fb2e5",
            "horizon-color": "#d9e7f5",
            "fog-color": "#eaf0f6",
            "sky-horizon-blend": 0.55,
            "horizon-fog-blend": 0.55,
            "fog-ground-blend": 0.8,
            "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 0],
          },
    );
  } catch {
    /* setSky non supportato: ignora */
  }
}
