"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PoiCategory } from "@/lib/db";
import { resolvePoiKind } from "@/lib/categories";
import type { V2SearchPoi } from "@/app/api/v2/pois/search/route";
import type { ViewBbox } from "@/lib/overpass";

export type V2Waypoint = { lng: number; lat: number; label?: string };

export type V2MapClickTarget =
  | { kind: "map"; lng: number; lat: number }
  | { kind: "waypoint"; index: number; lng: number; lat: number }
  | { kind: "poi"; poi: V2SearchPoi };

type Props = {
  waypoints: V2Waypoint[];
  routeCoords: [number, number][] | null;
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
};

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

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function setGeoJson(map: MaplibreMap, sourceId: string, data: GeoJSON.FeatureCollection) {
  const src = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (src) src.setData(data);
}

export default function V2PlanMap({
  waypoints,
  routeCoords,
  pois,
  poiSearchCenter,
  poiSearchBbox,
  pendingPoint,
  onMapInteraction,
  onWaypointMove,
  onViewportChange,
  initialCenter,
  flyTo,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const layersReadyRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const onInteractionRef = useRef(onMapInteraction);
  const onWaypointMoveRef = useRef(onWaypointMove);
  const onViewportChangeRef = useRef(onViewportChange);
  const poisRef = useRef(pois);
  const waypointsRef = useRef(waypoints);
  const dragRef = useRef<{ index: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

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

  const initOverlayLayers = useCallback((map: MaplibreMap) => {
    if (layersReadyRef.current) return;
    layersReadyRef.current = true;

    map.addSource("v2-route", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "v2-route",
      type: "line",
      source: "v2-route",
      paint: { "line-color": "#38bdf8", "line-width": 5, "line-opacity": 0.92 },
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
        "circle-radius": 16,
        "circle-color": "#38bdf8",
        "circle-opacity": 0.2,
      },
    });
    map.addLayer({
      id: "v2-waypoints",
      type: "circle",
      source: "v2-waypoints",
      paint: {
        "circle-radius": 10,
        "circle-color": "#f6f8ff",
        "circle-stroke-width": 3,
        "circle-stroke-color": "#38bdf8",
      },
    });

    const interactiveLayers = ["v2-pois-hit", "v2-waypoints", "v2-waypoints-halo"];
    for (const layerId of interactiveLayers) {
      map.on("mouseenter", layerId, () => {
        if (!dragRef.current) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        if (!dragRef.current) map.getCanvas().style.cursor = "";
      });
    }

    map.on("mousedown", "v2-waypoints", (e) => {
      if (e.originalEvent.button !== 0) return;
      const idx = Number((e.features?.[0]?.properties as { idx?: number } | undefined)?.idx);
      if (!Number.isFinite(idx) || idx < 1) return;
      dragRef.current = { index: idx - 1, startX: e.point.x, startY: e.point.y, moved: false };
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
      e.preventDefault();
    });

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
      const poiHits = map.queryRenderedFeatures(e.point, { layers: ["v2-pois-hit"] });
      if (poiHits.length > 0) {
        const props = poiHits[0].properties as { id?: string };
        const poi = poisRef.current.find((p) => p.id === props.id);
        if (poi) {
          onInteractionRef.current({ kind: "poi", poi });
          return;
        }
      }

      onInteractionRef.current({ kind: "map", lng: e.lngLat.lng, lat: e.lngLat.lat });
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [initialCenter?.lng ?? 23.7275, initialCenter?.lat ?? 37.9838],
      zoom: initialCenter?.zoom ?? 10,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.on("load", () => {
      initOverlayLayers(map);
      setMapReady(true);
      const b = map.getBounds();
      onViewportChangeRef.current?.({
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      });
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
      layersReadyRef.current = false;
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [initOverlayLayers, initialCenter?.lat, initialCenter?.lng, initialCenter?.zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layersReadyRef.current) return;

    const routeGeo: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features:
        routeCoords && routeCoords.length >= 2
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routeCoords } }]
          : [],
    };

    const wpGeo: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: waypoints.map((w, i) => ({
        type: "Feature",
        properties: { idx: i + 1, label: w.label ?? String(i + 1) },
        geometry: { type: "Point", coordinates: [w.lng, w.lat] },
      })),
    };

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
    setGeoJson(map, "v2-waypoints", wpGeo);
    setGeoJson(map, "v2-pois", poiGeo);
    setGeoJson(map, "v2-pending", pendingGeo);
    setGeoJson(map, "v2-poi-radius", radiusGeo);
  }, [routeCoords, waypoints, pois, pendingPoint, poiSearchCenter, poiSearchBbox, mapReady]);

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

  return <div ref={containerRef} className="h-full w-full min-h-0" />;
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
