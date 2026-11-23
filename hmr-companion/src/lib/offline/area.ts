/**
 * Mappe offline: elenco degli URL da scaricare per un'area (tile vettoriali
 * OpenFreeMap, DEM Mapterhorn per rilievo e curve, font delle etichette).
 * Il service worker li mette in una cache dedicata che non scade con gli
 * aggiornamenti dell'app; quando si è offline la mappa li legge da lì.
 */

export type OfflineBbox = { south: number; west: number; north: number; east: number };

export type OfflineArea = {
  id: string;
  name: string;
  bbox: OfflineBbox;
  minZoom: number;
  maxZoom: number;
  tiles: number;
  bytes: number;
  createdAt: number;
};

/** Zoom delle tile vettoriali scaricate (OpenFreeMap arriva a z14, oltre si ingrandisce). */
export const OFFLINE_VECTOR_ZOOMS = { min: 6, max: 14 } as const;
/** DEM fino a z12 (come la mappa online). */
export const OFFLINE_DEM_MAX_ZOOM = 12;
export const OFFLINE_MAX_TILES = 4000;

/** Dimensioni medie osservate, per la stima prima di scaricare. */
const AVG_VECTOR_BYTES = 45_000;
const AVG_DEM_BYTES = 120_000;

export const OFFLINE_FONTS = ["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"] as const;
/** Latino, Latino esteso, punteggiatura generale. */
export const OFFLINE_GLYPH_RANGES = ["0-255", "256-511", "8192-8447"] as const;

const OFM_GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const DEM_TILES = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
export const OFM_TILEJSON = "https://tiles.openfreemap.org/planet";

function lon2tile(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function lat2tile(lat: number, z: number): number {
  const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export function tileRange(b: OfflineBbox, z: number): { x0: number; x1: number; y0: number; y1: number; count: number } {
  const x0 = lon2tile(b.west, z);
  const x1 = lon2tile(b.east, z);
  const y0 = lat2tile(b.north, z);
  const y1 = lat2tile(b.south, z);
  return { x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

export function estimateArea(b: OfflineBbox, maxZoom: number = OFFLINE_VECTOR_ZOOMS.max) {
  let vector = 0;
  let dem = 0;
  for (let z = OFFLINE_VECTOR_ZOOMS.min; z <= maxZoom; z++) vector += tileRange(b, z).count;
  for (let z = OFFLINE_VECTOR_ZOOMS.min; z <= Math.min(OFFLINE_DEM_MAX_ZOOM, maxZoom); z++) dem += tileRange(b, z).count;
  return { tiles: vector + dem, bytes: vector * AVG_VECTOR_BYTES + dem * AVG_DEM_BYTES };
}

/** Zoom massimo che tiene l'area sotto il limite di tile (aree grandi → meno dettaglio). */
export function bestMaxZoom(b: OfflineBbox, limit = OFFLINE_MAX_TILES): number {
  for (let z = OFFLINE_VECTOR_ZOOMS.max; z > OFFLINE_VECTOR_ZOOMS.min; z--) {
    if (estimateArea(b, z).tiles <= limit) return z;
  }
  return OFFLINE_VECTOR_ZOOMS.min;
}

/** URL da scaricare. `vectorTemplate` arriva dal TileJSON di OpenFreeMap (contiene la versione). */
export function offlineUrls(b: OfflineBbox, maxZoom: number, vectorTemplate: string): string[] {
  const out: string[] = [OFM_TILEJSON];
  const push = (tpl: string, z: number) => {
    const r = tileRange(b, z);
    for (let x = r.x0; x <= r.x1; x++) {
      for (let y = r.y0; y <= r.y1; y++) out.push(tpl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)));
    }
  };
  for (let z = OFFLINE_VECTOR_ZOOMS.min; z <= maxZoom; z++) push(vectorTemplate, z);
  for (let z = OFFLINE_VECTOR_ZOOMS.min; z <= Math.min(OFFLINE_DEM_MAX_ZOOM, maxZoom); z++) push(DEM_TILES, z);
  for (const f of OFFLINE_FONTS) {
    for (const r of OFFLINE_GLYPH_RANGES) out.push(OFM_GLYPHS.replace("{fontstack}", encodeURIComponent(f)).replace("{range}", r));
  }
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 100 * 1024 * 1024 ? 1 : 0)} MB`;
}
