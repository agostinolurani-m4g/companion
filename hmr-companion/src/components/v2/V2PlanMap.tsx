"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PoiCategory } from "@/lib/db";
import { resolvePoiKind } from "@/lib/categories";
import type { V2SearchPoi } from "@/app/api/v2/pois/search/route";
import { DEFAULT_MAP_VIEW_CENTER } from "@/lib/map-defaults";
import type { ViewBbox } from "@/lib/overpass";
import type { RouteColoredSegment } from "@/lib/ors-route-tech";
import { AVALANCHE_LEGEND, SKI_AVALANCHE_DEFAULT_OPACITY, SKI_SLOPE_DEFAULT_OPACITY, SLOPE_TILES_URL } from "@/lib/ski-overlays";

export type V2Waypoint = { lng: number; lat: number; label?: string };

export type V2MapClickTarget =
  | { kind: "map"; lng: number; lat: number }
  | { kind: "waypoint"; index: number; lng: number; lat: number }
  | { kind: "poi"; poi: V2SearchPoi };

type Props = {
  waypoints: V2Waypoint[];
  routeCoords: [number, number][] | null;
  /** Tratti colorati per superficie (da ORS extra_info). */
  routeColoredSegments?: RouteColoredSegment[] | null;
  pois: V2SearchPoi[];
  poiSearchCenter?: { lng: number; lat: number } | null;
  poiSearchBbox?: ViewBbox | null;
  pendingPoint?: { lng: number; lat: number } | null;
  onMapInteraction: (target: V2MapClickTarget) => void;
  onWaypointMove?: (index: number, lng: number, lat: number) => void;
  onViewportChange?: (bbox: ViewBbox) => void;
  initialCenter?: { lng: number; lat: number; zoom?: number };
  /** Volo mappa verso un punto (incrementare `key` per ripetere). */
  flyTo?: { lng: number; lat: number; zoom?: number; key?: number } | null;
  /** Overlay raster pendenza (>30/45/60/70°). */
  slopeVisible?: boolean;
  slopeOpacity?: number;
  /** Overlay GeoJSON bollettino valanghe (EAWS). */
  avalancheGeoJson?: GeoJSON.FeatureCollection | null;
  avalancheVisible?: boolean;
  avalancheOpacity?: number;
  /** Nasconde pallini tappa (es. mappa esplorabile). */
  showWaypoints?: boolean;
  /** FeatureCollection esplorazione (routeId in properties). */
  exploreGeoJson?: GeoJSON.FeatureCollection | null;
  /** Click su traccia in modalità esplora. */
  onRouteSelect?: (routeId: string) => void;
  /** Marker partenza (P) / arrivo (A). */
  routeMarkersGeoJson?: GeoJSON.FeatureCollection | null;
};

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() || undefined;

const MAPTILER_STYLES = {
  outdoor: "outdoor-v2",
  streets: "streets-v2",
  dark: "dataviz-dark",
} as const;

type BaseStyleId = keyof typeof MAPTILER_STYLES;

const BASE_STYLE_LABELS: Record<BaseStyleId, string> = {
  outdoor: "Outdoor",
  streets: "Streets",
  dark: "Dark",
};

function maptilerStyleUrl(id: BaseStyleId, key: string): string {
  return `https://api.maptiler.com/maps/${MAPTILER_STYLES[id]}/style.json?key=${key}`;
}

/** Raster fallback when no MapTiler key is configured. */
const OSM_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap",
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const AVALANCHE_FILL_COLOR: maplibregl.ExpressionSpecification = [
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

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Pallini tappe: più piccoli da lontano, più grandi zoomando. */
const WAYPOINT_RADIUS = [
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
] as const;

const WAYPOINT_HALO_RADIUS = [
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
] as const;

const WAYPOINT_STROKE_WIDTH = [
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
] as const;

/** Contorno traccia per leggibilità su qualsiasi sfondo. */
const ROUTE_CASING_WIDTH = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  3,
  11,
  4,
  13,
  5,
  15,
  6,
  17,
  8,
  19,
  10,
] as const;

/** Traccia sottile ma visibile grazie al casing. */
const ROUTE_LINE_WIDTH = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  1.5,
  11,
  2,
  13,
  2.5,
  15,
  3,
  17,
  3.5,
  19,
  4,
] as const;

function setGeoJson(map: MaplibreMap, sourceId: string, data: GeoJSON.FeatureCollection) {
  const src = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (src) src.setData(data);
}

export default function V2PlanMap({
  waypoints,
  routeCoords,
  routeColoredSegments,
  pois,
  poiSearchCenter,
  poiSearchBbox,
  pendingPoint,
  onMapInteraction,
  onWaypointMove,
  onViewportChange,
  initialCenter,
  flyTo,
  slopeVisible = false,
  slopeOpacity = SKI_SLOPE_DEFAULT_OPACITY,
  avalancheGeoJson,
  avalancheVisible = false,
  avalancheOpacity = SKI_AVALANCHE_DEFAULT_OPACITY,
  showWaypoints = true,
  exploreGeoJson,
  onRouteSelect,
  routeMarkersGeoJson,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const layersReadyRef = useRef(false);
  const globalHandlersAttachedRef = useRef(false);
  const layerHandlerCleanupRef = useRef<(() => void) | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [baseStyle, setBaseStyle] = useState<BaseStyleId>("outdoor");
  const [overlayEpoch, setOverlayEpoch] = useState(0);
  const onInteractionRef = useRef(onMapInteraction);
  const onWaypointMoveRef = useRef(onWaypointMove);
  const onViewportChangeRef = useRef(onViewportChange);
  const poisRef = useRef(pois);
  const waypointsRef = useRef(waypoints);
  const dragRef = useRef<{ index: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const onRouteSelectRef = useRef(onRouteSelect);

  useEffect(() => {
    onRouteSelectRef.current = onRouteSelect;
  }, [onRouteSelect]);

  useEffect(() => {
    onInteractionRef.current = onMapInteraction;
  }, [onMapInteraction]);
  useEffect(() => {
    onWaypointMoveRef.current = onWaypointMove;
  }, [onWaypointMove]);
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);
  useEffect(() => {
    poisRef.current = pois;
  }, [pois]);
  useEffect(() => {
    waypointsRef.current = waypoints;
  }, [waypoints]);

  const addRasterOverlay = useCallback(
    (
      map: MaplibreMap,
      sourceId: string,
      layerId: string,
      tilesUrl: string,
      visible: boolean,
      opacity: number,
    ) => {
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
        paint: { "raster-opacity": opacity },
        layout: { visibility: visible ? "visible" : "none" },
      });
    },
    [],
  );

  const addOverlaySourcesAndLayers = useCallback(
    (map: MaplibreMap) => {
      if (map.getSource("v2-route")) return;

      addRasterOverlay(map, "ski-slope", "ski-slope", SLOPE_TILES_URL, slopeVisible, slopeOpacity);

      map.addSource("ski-avalanche", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "ski-avalanche-fill",
        type: "fill",
        source: "ski-avalanche",
        paint: {
          "fill-color": AVALANCHE_FILL_COLOR,
          "fill-opacity": avalancheOpacity,
        },
        layout: { visibility: avalancheVisible ? "visible" : "none" },
      });
      map.addLayer({
        id: "ski-avalanche-line",
        type: "line",
        source: "ski-avalanche",
        paint: {
          "line-color": "#0f172a",
          "line-width": 0.6,
          "line-opacity": avalancheVisible ? avalancheOpacity * 0.5 : 0,
        },
        layout: { visibility: avalancheVisible ? "visible" : "none" },
      });

      map.addSource("v2-route", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "v2-route-casing",
        type: "line",
        source: "v2-route",
        paint: {
          "line-color": "#0b1221",
          "line-width": ROUTE_CASING_WIDTH,
          "line-opacity": ["case", ["==", ["get", "dimmed"], true], 0.35, 0.85],
        },
      });
      map.addLayer({
        id: "v2-route",
        type: "line",
        source: "v2-route",
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#38bdf8"],
          "line-width": ROUTE_LINE_WIDTH,
          "line-opacity": ["case", ["==", ["get", "dimmed"], true], 0.28, 0.92],
        },
      });
      map.addLayer({
        id: "v2-route-hit",
        type: "line",
        source: "v2-route",
        paint: {
          "line-color": "#000000",
          "line-width": 12,
          "line-opacity": 0,
        },
      });

      map.addSource("v2-route-markers", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "v2-route-markers-halo",
        type: "circle",
        source: "v2-route-markers",
        paint: {
          "circle-radius": 12,
          "circle-color": ["get", "haloColor"],
          "circle-opacity": 0.28,
        },
      });
      map.addLayer({
        id: "v2-route-markers",
        type: "circle",
        source: "v2-route-markers",
        paint: {
          "circle-radius": 7,
          "circle-color": ["get", "color"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0b1221",
        },
      });

    map.addSource("v2-poi-radius", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "v2-poi-radius",
      type: "fill",
      source: "v2-poi-radius",
      paint: { "fill-color": "#fb923c", "fill-opacity": 0.04 },
    });
    map.addLayer({
      id: "v2-poi-radius-line",
      type: "line",
      source: "v2-poi-radius",
      paint: { "line-color": "#fb923c", "line-width": 1, "line-opacity": 0.22, "line-dasharray": [2, 3] },
    });

    map.addSource("v2-pois", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "v2-pois",
      type: "circle",
      source: "v2-pois",
      paint: {
        "circle-radius": 4,
        "circle-color": ["get", "color"],
        "circle-opacity": 0.72,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#0b1221",
        "circle-stroke-opacity": 0.65,
      },
    });
    map.addLayer({
      id: "v2-pois-hit",
      type: "circle",
      source: "v2-pois",
      paint: { "circle-radius": 10, "circle-opacity": 0 },
    });

    map.addSource("v2-pending", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "v2-pending",
      type: "circle",
      source: "v2-pending",
      paint: {
        "circle-radius": 11,
        "circle-color": "#fbbf24",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#0b1221",
        "circle-opacity": 0.95,
      },
    });

    map.addSource("v2-waypoints", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "v2-waypoints-halo",
      type: "circle",
      source: "v2-waypoints",
      paint: {
        "circle-radius": WAYPOINT_HALO_RADIUS,
        "circle-color": "#38bdf8",
        "circle-opacity": 0.2,
      },
    });
    map.addLayer({
      id: "v2-waypoints",
      type: "circle",
      source: "v2-waypoints",
      paint: {
        "circle-radius": WAYPOINT_RADIUS,
        "circle-color": "#f6f8ff",
        "circle-stroke-width": WAYPOINT_STROKE_WIDTH,
        "circle-stroke-color": "#38bdf8",
      },
    });
    },
    [addRasterOverlay, avalancheOpacity, avalancheVisible, slopeOpacity, slopeVisible],
  );

  const bindLayerHandlers = useCallback((map: MaplibreMap) => {
    layerHandlerCleanupRef.current?.();
    layerHandlerCleanupRef.current = null;

    const interactiveLayers = ["v2-pois-hit", "v2-waypoints", "v2-waypoints-halo"];
    const onLayerEnter = () => {
      if (!dragRef.current) map.getCanvas().style.cursor = "pointer";
    };
    const onLayerLeave = () => {
      if (!dragRef.current) map.getCanvas().style.cursor = "";
    };
    const onWaypointMouseDown = (e: maplibregl.MapLayerMouseEvent) => {
      if (e.originalEvent.button !== 0) return;
      const idx = Number((e.features?.[0]?.properties as { idx?: number } | undefined)?.idx);
      if (!Number.isFinite(idx) || idx < 1) return;
      dragRef.current = { index: idx - 1, startX: e.point.x, startY: e.point.y, moved: false };
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
      e.preventDefault();
    };

    for (const layerId of interactiveLayers) {
      map.on("mouseenter", layerId, onLayerEnter);
      map.on("mouseleave", layerId, onLayerLeave);
    }
    map.on("mousedown", "v2-waypoints", onWaypointMouseDown);

    const onRouteEnter = () => {
      if (!dragRef.current && onRouteSelectRef.current) map.getCanvas().style.cursor = "pointer";
    };
    const onRouteLeave = () => {
      if (!dragRef.current) map.getCanvas().style.cursor = "";
    };
    const onRouteClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!onRouteSelectRef.current) return;
      const f = e.features?.[0];
      const routeId = (f?.properties as { routeId?: string } | undefined)?.routeId;
      if (routeId) {
        e.preventDefault();
        onRouteSelectRef.current(routeId);
      }
    };
    map.on("mouseenter", "v2-route-hit", onRouteEnter);
    map.on("mouseleave", "v2-route-hit", onRouteLeave);
    map.on("click", "v2-route-hit", onRouteClick);

    layerHandlerCleanupRef.current = () => {
      for (const layerId of interactiveLayers) {
        map.off("mouseenter", layerId, onLayerEnter);
        map.off("mouseleave", layerId, onLayerLeave);
      }
      map.off("mousedown", "v2-waypoints", onWaypointMouseDown);
      map.off("mouseenter", "v2-route-hit", onRouteEnter);
      map.off("mouseleave", "v2-route-hit", onRouteLeave);
      map.off("click", "v2-route-hit", onRouteClick);
    };
  }, []);

  const attachGlobalHandlers = useCallback((map: MaplibreMap) => {
    if (globalHandlersAttachedRef.current) return;
    globalHandlersAttachedRef.current = true;

    map.on("mousemove", (e) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.point.x - drag.startX;
      const dy = e.point.y - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > 5) drag.moved = true;
      if (drag.moved) {
        onWaypointMoveRef.current?.(drag.index, e.lngLat.lng, e.lngLat.lat);
      }
    });

    const finishDrag = (e: maplibregl.MapMouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
      if (drag.moved) {
        suppressClickRef.current = true;
        onWaypointMoveRef.current?.(drag.index, e.lngLat.lng, e.lngLat.lat);
      } else {
        const wp = waypointsRef.current[drag.index];
        if (wp) {
          onInteractionRef.current({
            kind: "waypoint",
            index: drag.index,
            lng: wp.lng,
            lat: wp.lat,
          });
        }
      }
    };

    map.on("mouseup", finishDrag);
    map.on("mouseout", (e) => {
      if (dragRef.current) finishDrag(e);
    });

    map.on("click", (e) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const poiHits = map.getLayer("v2-pois-hit")
        ? map.queryRenderedFeatures(e.point, { layers: ["v2-pois-hit"] })
        : [];
      if (poiHits.length > 0) {
        const props = poiHits[0].properties as { id?: string };
        const poi = poisRef.current.find((p) => p.id === props.id);
        if (poi) {
          onInteractionRef.current({ kind: "poi", poi });
          return;
        }
      }

      if (onRouteSelectRef.current && map.getLayer("v2-route-hit")) {
        const routeHits = map.queryRenderedFeatures(e.point, { layers: ["v2-route-hit"] });
        if (routeHits.length > 0) {
          const routeId = (routeHits[0].properties as { routeId?: string }).routeId;
          if (routeId) {
            onRouteSelectRef.current(routeId);
            return;
          }
        }
      }

      onInteractionRef.current({ kind: "map", lng: e.lngLat.lng, lat: e.lngLat.lat });
    });
  }, []);

  const ensureOverlays = useCallback(
    (map: MaplibreMap) => {
      addOverlaySourcesAndLayers(map);
      bindLayerHandlers(map);
      attachGlobalHandlers(map);
      layersReadyRef.current = true;
      setOverlayEpoch((n) => n + 1);
    },
    [addOverlaySourcesAndLayers, attachGlobalHandlers, bindLayerHandlers],
  );

  const handleStyleReady = useCallback(
    (map: MaplibreMap) => {
      if (!map.isStyleLoaded()) return;
      ensureOverlays(map);
      setMapReady(true);
      const b = map.getBounds();
      onViewportChangeRef.current?.({
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      });
    },
    [ensureOverlays],
  );

  const changeBaseStyle = useCallback(
    (id: BaseStyleId) => {
      const map = mapRef.current;
      if (!map || !MAPTILER_KEY || id === baseStyle) return;
      setBaseStyle(id);
      layersReadyRef.current = false;
      map.setStyle(maptilerStyleUrl(id, MAPTILER_KEY));
      // Overlays are re-added by the persistent "styledata" handler once the new
      // style is fully loaded; a one-shot listener here can fire too early.
    },
    [baseStyle, handleStyleReady],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initialStyle = MAPTILER_KEY ? maptilerStyleUrl("outdoor", MAPTILER_KEY) : OSM_STYLE;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyle,
      center: [
        initialCenter?.lng ?? DEFAULT_MAP_VIEW_CENTER.lng,
        initialCenter?.lat ?? DEFAULT_MAP_VIEW_CENTER.lat,
      ],
      zoom: initialCenter?.zoom ?? DEFAULT_MAP_VIEW_CENTER.zoom,
      pitch: MAPTILER_KEY ? 30 : 0,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: Boolean(MAPTILER_KEY) }), "top-right");
    map.on("load", () => handleStyleReady(map));
    map.on("styledata", () => {
      // Re-add overlays whenever the style is (re)loaded and our layers are
      // missing (e.g. after a base-style switch). Relying on layersReadyRef is
      // fragile because setStyle wipes custom layers without resetting the ref.
      if (map.isStyleLoaded() && !map.getLayer("v2-route")) {
        layersReadyRef.current = false;
        handleStyleReady(map);
      }
    });
    map.on("moveend", () => {
      const b = map.getBounds();
      onViewportChangeRef.current?.({
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      });
    });
    mapRef.current = map;
    return () => {
      layerHandlerCleanupRef.current?.();
      layerHandlerCleanupRef.current = null;
      layersReadyRef.current = false;
      globalHandlersAttachedRef.current = false;
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [handleStyleReady, initialCenter?.lat, initialCenter?.lng, initialCenter?.zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layersReadyRef.current) return;

    const routeGeo: GeoJSON.FeatureCollection = (() => {
      if (exploreGeoJson && exploreGeoJson.features.length > 0) {
        return exploreGeoJson;
      }
      if (routeColoredSegments && routeColoredSegments.length > 0) {
        return {
          type: "FeatureCollection",
          features: routeColoredSegments.map((seg, i) => ({
            type: "Feature" as const,
            properties: { color: seg.color, surface: seg.surface, idx: i },
            geometry: { type: "LineString" as const, coordinates: seg.coordinates },
          })),
        };
      }
      if (routeCoords && routeCoords.length >= 2) {
        return {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: routeCoords },
            },
          ],
        };
      }
      return EMPTY_FC;
    })();

    const wpGeo: GeoJSON.FeatureCollection = showWaypoints
      ? {
          type: "FeatureCollection",
          features: waypoints.map((w, i) => ({
            type: "Feature",
            properties: { idx: i + 1, label: w.label ?? String(i + 1) },
            geometry: { type: "Point", coordinates: [w.lng, w.lat] },
          })),
        }
      : EMPTY_FC;

    const poiGeo: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: pois.map((p) => {
        const kindMeta = resolvePoiKind(p.category as PoiCategory, p.sub_kind);
        return {
          type: "Feature",
          properties: {
            id: p.id,
            name: p.name ?? kindMeta.label,
            category: p.category,
            kind: kindMeta.label,
            color: kindMeta.color,
          },
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        };
      }),
    };

    const pendingGeo: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: pendingPoint
        ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [pendingPoint.lng, pendingPoint.lat] } }]
        : [],
    };

    let radiusGeo: GeoJSON.FeatureCollection = EMPTY_FC;
    if (poiSearchBbox) {
      const { south, west, north, east } = poiSearchBbox;
      radiusGeo = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [west, south],
                  [east, south],
                  [east, north],
                  [west, north],
                  [west, south],
                ],
              ],
            },
          },
        ],
      };
    } else if (poiSearchCenter) {
      radiusGeo = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [circlePolygon(poiSearchCenter.lng, poiSearchCenter.lat, 3000, 64)],
            },
          },
        ],
      };
    }

    setGeoJson(map, "v2-route", routeGeo);
    setGeoJson(map, "v2-route-markers", routeMarkersGeoJson ?? EMPTY_FC);
    setGeoJson(map, "v2-waypoints", wpGeo);
    setGeoJson(map, "v2-pois", poiGeo);
    setGeoJson(map, "v2-pending", pendingGeo);
    setGeoJson(map, "v2-poi-radius", radiusGeo);
  }, [
    routeCoords,
    routeColoredSegments,
    exploreGeoJson,
    routeMarkersGeoJson,
    waypoints,
    showWaypoints,
    pois,
    pendingPoint,
    poiSearchCenter,
    poiSearchBbox,
    mapReady,
    overlayEpoch,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layersReadyRef.current) return;
    if (map.getLayer("ski-slope")) {
      map.setLayoutProperty("ski-slope", "visibility", slopeVisible ? "visible" : "none");
      map.setPaintProperty("ski-slope", "raster-opacity", slopeOpacity);
    }
    for (const layerId of ["ski-avalanche-fill", "ski-avalanche-line"]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", avalancheVisible ? "visible" : "none");
      }
    }
    if (map.getLayer("ski-avalanche-fill")) {
      map.setPaintProperty("ski-avalanche-fill", "fill-opacity", avalancheOpacity);
    }
    if (map.getLayer("ski-avalanche-line")) {
      map.setPaintProperty("ski-avalanche-line", "line-opacity", avalancheVisible ? avalancheOpacity * 0.5 : 0);
    }
  }, [mapReady, slopeVisible, slopeOpacity, avalancheVisible, avalancheOpacity, overlayEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layersReadyRef.current) return;
    if (avalancheGeoJson) {
      setGeoJson(map, "ski-avalanche", avalancheGeoJson);
    }
  }, [avalancheGeoJson, mapReady, overlayEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !poiSearchCenter || poiSearchBbox || pois.length === 0) return;
    map.flyTo({ center: [poiSearchCenter.lng, poiSearchCenter.lat], zoom: Math.max(map.getZoom(), 13), duration: 800 });
  }, [poiSearchCenter, poiSearchBbox, pois.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo({
      center: [flyTo.lng, flyTo.lat],
      zoom: flyTo.zoom ?? Math.max(map.getZoom(), 13),
      duration: 900,
    });
  }, [flyTo?.lng, flyTo?.lat, flyTo?.zoom, flyTo?.key]);

  return (
    <div className="relative h-full w-full min-h-0">
      <div ref={containerRef} className="h-full w-full min-h-0" />
      {MAPTILER_KEY ? (
        <div
          className="absolute top-3 left-3 z-10 flex gap-1 rounded-lg border border-white/10 bg-slate-900/85 p-1 shadow-lg backdrop-blur-sm"
          role="group"
          aria-label="Stile base map"
        >
          {(Object.keys(MAPTILER_STYLES) as BaseStyleId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => changeBaseStyle(id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                baseStyle === id
                  ? "bg-sky-500 text-slate-950"
                  : "text-slate-200 hover:bg-white/10"
              }`}
            >
              {BASE_STYLE_LABELS[id]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Approximate circle polygon in WGS84 (good enough for 3 km radius). */
function circlePolygon(lng: number, lat: number, radiusM: number, steps: number): [number, number][] {
  const coords: [number, number][] = [];
  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(latRad);
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    coords.push([
      lng + (radiusM * Math.cos(angle)) / mPerDegLng,
      lat + (radiusM * Math.sin(angle)) / mPerDegLat,
    ]);
  }
  return coords;
}
