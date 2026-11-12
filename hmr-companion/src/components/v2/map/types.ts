import type { V2SearchPoi } from "@/app/api/v2/pois/search/route";
import type { RouteColoredSegment } from "@/lib/ors-route-tech";
import type { MapOverlayId, UserRouteActivity } from "@/lib/sports";
import type { ViewBbox } from "@/lib/overpass";

export type V2Waypoint = { lng: number; lat: number; label?: string };

export type V2OutdoorFeaturePick = {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
};

/** Luogo cliccato sulle etichette della mappa base (vetta, paese, rifugio, lago…). */
export type V2MapPlacePick = {
  id: string;
  name: string;
  kindLabel: string;
  lat: number;
  lng: number;
  ele?: number | null;
  wikidata?: string | null;
};

export type V2MapClickTarget =
  | { kind: "map"; lng: number; lat: number }
  | { kind: "waypoint"; index: number; lng: number; lat: number }
  | { kind: "poi"; poi: V2SearchPoi }
  | { kind: "feature"; feature: V2OutdoorFeaturePick }
  | { kind: "place"; place: V2MapPlacePick };

export type V2PlanMapProps = {
  waypoints: V2Waypoint[];
  routeCoords: [number, number][] | null;
  routeColoredSegments?: RouteColoredSegment[] | null;
  pois: V2SearchPoi[];
  poiSearchCenter?: { lng: number; lat: number } | null;
  poiSearchBbox?: ViewBbox | null;
  pendingPoint?: { lng: number; lat: number } | null;
  onMapInteraction: (target: V2MapClickTarget) => void;
  onWaypointMove?: (index: number, lng: number, lat: number) => void;
  /** Trascinamento della linea del percorso: crea una tappa e ne restituisce l'indice. */
  onRouteDragStart?: (lng: number, lat: number) => number | null;
  onViewportChange?: (bbox: ViewBbox, meta?: { zoom: number }) => void;
  initialCenter?: { lng: number; lat: number; zoom?: number };
  flyTo?: { lng: number; lat: number; zoom?: number; key?: number } | null;
  /** Inquadra un bbox [w, s, e, n] quando cambia `key`. */
  fitTo?: { bbox: [number, number, number, number]; key: number; padding?: number | { top: number; bottom: number; left: number; right: number } } | null;
  /** Punto evidenziato (hover sul profilo altimetrico). */
  hoverPoint?: { lng: number; lat: number } | null;
  /** Mostra la barra di caricamento (routing, ricerche…). */
  busy?: boolean;
  /** Area coperta da pannelli (px): la camera centra e inquadra nella parte visibile. */
  viewPadding?: { top?: number; bottom?: number; left?: number; right?: number };
  /** Spazio libero in alto per i controlli (px), es. sotto una barra di ricerca. */
  controlsTopOffset?: number;
  slopeVisible?: boolean;
  slopeOpacity?: number;
  avalancheGeoJson?: GeoJSON.FeatureCollection | null;
  avalancheVisible?: boolean;
  avalancheOpacity?: number;
  showWaypoints?: boolean;
  exploreGeoJson?: GeoJSON.FeatureCollection | null;
  photosGeoJson?: GeoJSON.FeatureCollection | null;
  /** Soste della gita pianificata (properties: role, kind, name). */
  outingStopsGeoJson?: GeoJSON.FeatureCollection | null;
  reportsGeoJson?: GeoJSON.FeatureCollection | null;
  onRouteSelect?: (routeId: string) => void;
  onReportSelect?: (reportId: string) => void;
  routeMarkersGeoJson?: GeoJSON.FeatureCollection | null;
  terrain3d?: boolean;
  /** Sport attivo: stile topo e sovrapposizioni default. */
  mapSport?: UserRouteActivity;
  sportOverlays?: Partial<Record<MapOverlayId, boolean>>;
  onSportOverlaysChange?: (next: Partial<Record<MapOverlayId, boolean>>) => void;
  featuresGeoJson?: GeoJSON.FeatureCollection | null;
  /** In pianifica: i POI outdoor non intercettano il click (tappe). */
  pickOutdoorFeatures?: boolean;
  /** Le etichette della mappa base (vette, paesi, laghi…) sono cliccabili per le info. */
  pickMapLabels?: boolean;
  /** Tratti del percorso mai percorsi dalla community (tratteggio arancio). */
  untroddenGeoJson?: GeoJSON.FeatureCollection | null;
};
