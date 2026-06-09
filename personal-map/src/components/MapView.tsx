"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PoiCategory, PoiRow, TrackDifficultySegmentRow } from "@/lib/db";
import type { StoredCoord } from "@/lib/track-coords";
import { CATEGORY_META } from "@/lib/categories";
import { coordAtKm, projectLngLatToTrack } from "@/lib/track-measure";

export type MapViewProps = {
  coords: StoredCoord[];
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  pois: PoiRow[];
  visibleCategories: Set<PoiCategory>;
  myAlongKm: number | null;
  myPosition: { lat: number; lng: number } | null;
  hoverKm: number | null;
  onHoverKm?: (km: number | null) => void;
  onSelectPoi?: (poi: PoiRow) => void;
  difficultySegments?: TrackDifficultySegmentRow[];
  hazardCells?: Array<{ lat: number; lng: number; report_kind: string; confirmed_at: number | null }>;
};

const SEVERITY_LINE_COLORS: Record<string, string> = {
  info: "#94a3b8",
  caution: "#fbbf24",
  hard: "#f87171",
  extreme: "#a855f7",
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
    terrain: {
      type: "raster",
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenTopoMap (CC-BY-SA)",
      maxzoom: 17,
    },
  },
  layers: [
    { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 1 } },
    { id: "terrain", type: "raster", source: "terrain", paint: { "raster-opacity": 0.35 } },
  ],
};

export default function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const onHoverKmRef = useRef(props.onHoverKm);
  const onSelectPoiRef = useRef(props.onSelectPoi);

  useEffect(() => {
    onHoverKmRef.current = props.onHoverKm;
  }, [props.onHoverKm]);
  useEffect(() => {
    onSelectPoiRef.current = props.onSelectPoi;
  }, [props.onSelectPoi]);

  const coordsArray = useMemo<[number, number][]>(
    () => props.coords.map((c) => [c[0], c[1]]),
    [props.coords]
  );

  const poiFeatures = useMemo(() => {
    return props.pois
      .filter((p) => props.visibleCategories.has(p.category))
      .map((p) => ({
        type: "Feature" as const,
        properties: {
          id: p.id,
          category: p.category,
          name: p.name ?? "",
          color: CATEGORY_META[p.category]?.color ?? "#38bdf8",
        },
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      }));
  }, [props.pois, props.visibleCategories]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [
        (props.bbox.minLng + props.bbox.maxLng) / 2,
        (props.bbox.minLat + props.bbox.maxLat) / 2,
      ],
      zoom: 10,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showAccuracyCircle: true,
      }),
      "top-right"
    );

    map.on("load", () => {
      map.addSource("track", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } },
      });
      map.addLayer({
        id: "track-line-casing",
        type: "line",
        source: "track",
        paint: { "line-color": "#0b1221", "line-width": 7, "line-opacity": 0.5 },
      });
      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        paint: { "line-color": "#38bdf8", "line-width": 4, "line-opacity": 0.95 },
      });

      map.addSource("pois", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "pois-circle",
        type: "circle",
        source: "pois",
        paint: {
          "circle-radius": 6,
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#0b1221",
        },
      });

      map.addSource("position", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "position-circle",
        type: "circle",
        source: "position",
        paint: {
          "circle-radius": 8,
          "circle-color": "#4ade80",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0b1221",
        },
      });

      map.addSource("difficulty", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "difficulty-line",
        type: "line",
        source: "difficulty",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 6,
          "line-opacity": 0.85,
        },
      });

      map.addSource("hazards", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "hazards-circle",
        type: "circle",
        source: "hazards",
        paint: {
          "circle-radius": 10,
          "circle-color": "#a855f7",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fef08a",
          "circle-opacity": 0.9,
        },
      });

      map.fitBounds(
        [
          [props.bbox.minLng, props.bbox.minLat],
          [props.bbox.maxLng, props.bbox.maxLat],
        ],
        { padding: 40, duration: 0 }
      );

      map.on("mousemove", "track-line", (e) => {
        if (!e.lngLat) return;
        const proj = projectLngLatToTrack(props.coords, e.lngLat.lng, e.lngLat.lat);
        onHoverKmRef.current?.(proj?.alongKm ?? null);
      });
      map.on("mouseleave", "track-line", () => onHoverKmRef.current?.(null));

      map.on("click", "pois-circle", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = f.properties?.id as string;
        const poi = props.pois.find((p) => p.id === id);
        if (poi) onSelectPoiRef.current?.(poi);
      });

      setMapReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("track") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coordsArray },
    });
  }, [coordsArray, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("pois") as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: poiFeatures });
  }, [poiFeatures, mapReady]);

  const difficultyFeatures = useMemo(() => {
    if (!props.difficultySegments?.length || !props.coords.length) return [];
    return props.difficultySegments.map((seg) => {
      const segCoords = props.coords
        .filter((c) => c[3] >= seg.km_start - 0.01 && c[3] <= seg.km_end + 0.01)
        .map((c) => [c[0], c[1]] as [number, number]);
      if (segCoords.length < 2) return null;
      return {
        type: "Feature" as const,
        properties: { color: SEVERITY_LINE_COLORS[seg.severity] ?? "#f87171" },
        geometry: { type: "LineString" as const, coordinates: segCoords },
      };
    }).filter(Boolean);
  }, [props.difficultySegments, props.coords]);

  const hazardFeatures = useMemo(() => {
    return (props.hazardCells ?? []).map((h) => ({
      type: "Feature" as const,
      properties: { kind: h.report_kind },
      geometry: { type: "Point" as const, coordinates: [h.lng, h.lat] },
    }));
  }, [props.hazardCells]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("difficulty") as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: difficultyFeatures as GeoJSON.Feature[] });
  }, [difficultyFeatures, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("hazards") as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: hazardFeatures });
  }, [hazardFeatures, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    if (props.myPosition) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Point",
          coordinates: [props.myPosition.lng, props.myPosition.lat],
        },
      });
    }
    if (props.myAlongKm != null) {
      const c = coordAtKm(props.coords, props.myAlongKm);
      if (c) {
        features.push({
          type: "Feature",
          properties: { kind: "on-track" },
          geometry: { type: "Point", coordinates: [c.lng, c.lat] },
        });
      }
    }
    const src = map.getSource("position") as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features });
  }, [props.myPosition, props.myAlongKm, props.coords, mapReady]);

  return <div ref={containerRef} className="h-full w-full" />;
}
