/**
 * Rilievo pre-calcolato sul corridoio della traccia (vedi scripts/relief/).
 * Funzioni pure: nessuna dipendenza da maplibre, testabili in node.
 */

export const RELIEF_PMTILES_PATH = "/relief/hmr-relief.pmtiles";
export const RELIEF_MANIFEST_PATH = "/relief/manifest.json";

/** [west, south, east, north] in gradi. */
export type Bbox = [number, number, number, number];

export type ReliefManifest = {
  bounds: Bbox;
  minzoom: number;
  maxzoom: number;
  /** Lato delle celle del corridoio, in gradi. */
  cellDeg: number;
  /** Celle coperte dal rilievo pre-calcolato: chiave `"i:j"` con i = floor(lng/cellDeg), j = floor(lat/cellDeg). */
  cells: string[];
  generatedAt?: string;
};

export type ReliefMode = "pre" | "runtime";

/** Overzoom consentito oltre il maxzoom dell'archivio prima di tornare al runtime. */
const OVERZOOM = 2;

export function isReliefManifest(raw: unknown): raw is ReliefManifest {
  if (!raw || typeof raw !== "object") return false;
  const m = raw as Record<string, unknown>;
  return (
    Array.isArray(m.bounds) &&
    m.bounds.length === 4 &&
    m.bounds.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    typeof m.minzoom === "number" &&
    typeof m.maxzoom === "number" &&
    m.minzoom <= m.maxzoom &&
    typeof m.cellDeg === "number" &&
    m.cellDeg > 0 &&
    Array.isArray(m.cells) &&
    m.cells.every((c) => typeof c === "string")
  );
}

export function cellKey(lng: number, lat: number, cellDeg: number): string {
  return `${Math.floor(lng / cellDeg)}:${Math.floor(lat / cellDeg)}`;
}

const cellSets = new WeakMap<ReliefManifest, Set<string>>();
function cellSet(m: ReliefManifest): Set<string> {
  let s = cellSets.get(m);
  if (!s) cellSets.set(m, (s = new Set(m.cells)));
  return s;
}

/**
 * "pre" se tutta la vista (angoli, punti medi dei lati e centro) cade nel corridoio pre-calcolato
 * e lo zoom è nel suo range: allora l'ombreggiatura runtime va nascosta (niente doppia ombra
 * né zone scoperte ai bordi del corridoio). Altrimenti "runtime".
 */
export function reliefMode(view: Bbox, zoom: number, manifest: ReliefManifest | null): ReliefMode {
  if (!manifest) return "runtime";
  if (zoom < manifest.minzoom || zoom > manifest.maxzoom + OVERZOOM) return "runtime";
  const [w, s, e, n] = view;
  const mx = (w + e) / 2;
  const my = (s + n) / 2;
  const samples: Array<[number, number]> = [
    [w, s], [mx, s], [e, s],
    [w, my], [mx, my], [e, my],
    [w, n], [mx, n], [e, n],
  ];
  const cells = cellSet(manifest);
  return samples.every(([lng, lat]) => cells.has(cellKey(lng, lat, manifest.cellDeg))) ? "pre" : "runtime";
}

/**
 * Celle della griglia entro `bufferKm` dalla traccia. I segmenti vengono densificati
 * (passo ≤ mezza cella) così i tratti lunghi della traccia semplificata non lasciano buchi.
 */
export function corridorCells(coords: ReadonlyArray<readonly [number, number, ...unknown[]]>, bufferKm: number, cellDeg: number): string[] {
  const out = new Set<string>();
  const mark = (lng: number, lat: number) => {
    const dLat = bufferKm / 111.32;
    const dLng = bufferKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
    const i0 = Math.floor((lng - dLng) / cellDeg);
    const i1 = Math.floor((lng + dLng) / cellDeg);
    const j0 = Math.floor((lat - dLat) / cellDeg);
    const j1 = Math.floor((lat + dLat) / cellDeg);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) out.add(`${i}:${j}`);
  };
  for (let k = 0; k < coords.length; k++) {
    const [lng, lat] = coords[k];
    if (k === 0) {
      mark(lng, lat);
      continue;
    }
    const [plng, plat] = coords[k - 1];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(lng - plng), Math.abs(lat - plat)) / (cellDeg / 2)));
    for (let t = 1; t <= steps; t++) mark(plng + ((lng - plng) * t) / steps, plat + ((lat - plat) * t) / steps);
  }
  return [...out].sort();
}

/** Celle come poligoni GeoJSON (WGS84), per la maschera `gdal_rasterize`. */
export function cellsToGeoJson(cells: readonly string[], cellDeg: number): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: "FeatureCollection",
    features: cells.map((key) => {
      const [i, j] = key.split(":").map(Number);
      const w = i * cellDeg;
      const s = j * cellDeg;
      const e = w + cellDeg;
      const n = s + cellDeg;
      return {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      };
    }),
  };
}

/** Allarga un bbox di `km` chilometri per lato (correzione della longitudine con la latitudine). */
export function bufferBbox(bbox: Bbox, km: number): Bbox {
  const [w, s, e, n] = bbox;
  const dLat = km / 111.32;
  const midLat = ((s + n) / 2) * (Math.PI / 180);
  const dLng = km / (111.32 * Math.max(Math.cos(midLat), 0.01));
  return [
    Math.max(-180, w - dLng),
    Math.max(-85.05, s - dLat),
    Math.min(180, e + dLng),
    Math.min(85.05, n + dLat),
  ];
}

/** Estremi in EPSG:3857 (metri) di un bbox WGS84, per `gdal_translate -projwin`. */
export function bboxToMercator(bbox: Bbox): { minX: number; minY: number; maxX: number; maxY: number } {
  const R = 6378137;
  const x = (lng: number) => (lng * Math.PI * R) / 180;
  const y = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return { minX: x(bbox[0]), minY: y(bbox[1]), maxX: x(bbox[2]), maxY: y(bbox[3]) };
}
