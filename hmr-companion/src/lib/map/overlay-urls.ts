import type { MapOverlayId } from "@/lib/sports";

/** Raster tile templates (z/x/y placeholders). */
export const OVERLAY_TILE_URLS: Record<MapOverlayId, string | null> = {
  slope: "/api/v2/ski/slope-tiles/{z}/{x}/{y}",
  avalanche: null,
  opensnow: "https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png",
  aspect: null,
  waymarked_cycling: "https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png",
  waymarked_mtb: "https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png",
  waymarked_hiking: "https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png",
  road_surface: null,
  ferrata: null,
  sac_trails: null,
  contours: null,
  rainviewer: null,
};

export const OVERLAY_ATTRIBUTION: Partial<Record<MapOverlayId, string>> = {
  slope: "© OpenSlopeMap.org",
  opensnow: "© OpenSnowMap",
  waymarked_cycling: "© waymarkedtrails.org",
  waymarked_mtb: "© waymarkedtrails.org",
  waymarked_hiking: "© waymarkedtrails.org",
};

export function overlaySourceId(id: MapOverlayId): string {
  return `overlay-${id}`;
}

export function overlayLayerId(id: MapOverlayId): string {
  return `overlay-${id}-layer`;
}

export type OverlayDef = {
  id: MapOverlayId;
  label: string;
  hint: string;
  /** Colore pallino nel selettore. */
  swatch: string;
};

/** Sovrapposizioni realmente disponibili (con sorgente implementata). */
export const AVAILABLE_OVERLAYS: readonly OverlayDef[] = [
  { id: "waymarked_hiking", label: "Sentieri segnati", hint: "Rete escursionistica ufficiale", swatch: "#dc2626" },
  { id: "waymarked_mtb", label: "Percorsi MTB", hint: "Itinerari mountain bike", swatch: "#a855f7" },
  { id: "waymarked_cycling", label: "Ciclovie", hint: "Reti ciclabili nazionali e locali", swatch: "#2563eb" },
  { id: "slope", label: "Pendenza", hint: "Classi di inclinazione >27° (Alpi)", swatch: "#f97316" },
  { id: "opensnow", label: "Piste da sci", hint: "Piste e impianti (OpenSnowMap)", swatch: "#0ea5e9" },
  { id: "rainviewer", label: "Radar pioggia", hint: "Ultima scansione radar", swatch: "#22d3ee" },
];
